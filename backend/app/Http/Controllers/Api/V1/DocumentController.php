<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Jobs\ProcessDocumentJob;
use App\Models\Document;
use App\Models\Project;
use App\Services\AuditLogger;
use App\Services\EntitlementService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class DocumentController extends Controller
{
    public function __construct(
        private readonly EntitlementService $entitlements,
        private readonly AuditLogger $auditLogger,
    ) {
    }

    public function index(Request $request, Project $project)
    {
        $this->authorize('view', $project);

        // Not wrapped in an extra 'data' key - a paginator already
        // serializes as {data, links, meta}, matching ProjectController's
        // index() so every paginated list endpoint has the same shape.
        return response()->json($project->documents()->orderByDesc('created_at')->paginate(20));
    }

    /**
     * File processing lifecycle steps 1-5 (docs/02 section 2.4): quota
     * check, size/MIME/magic-byte validation, private storage under a
     * non-guessable key, then a `processing` record and a queued job for
     * text extraction.
     */
    public function store(Request $request, Project $project)
    {
        $this->authorize('create', [Document::class, $project]);

        $request->validate([
            'file' => ['required', 'file', 'mimes:pdf', 'max:'.(100 * 1024)],
        ]);

        $file = $request->file('file');

        $this->assertLooksLikePdf($file->getRealPath());

        $organization = $request->organization();

        $document = $this->entitlements->withinDocumentQuota(
            $organization,
            $project,
            $file->getSize(),
            function () use ($file, $project, $organization, $request) {
                $storageKey = 'documents/'.$organization->id.'/'.Str::uuid().'.pdf';

                // SEC-002 fix: stream from disk to disk via a file handle
                // rather than file_get_contents(), which read the entire
                // (up to 100MB) upload into one PHP string before storing
                // it - a needless memory spike per upload, worse under
                // concurrent uploads.
                $stream = fopen($file->getRealPath(), 'r');

                try {
                    Storage::disk('local')->put($storageKey, $stream);
                } finally {
                    if (is_resource($stream)) {
                        fclose($stream);
                    }
                }

                return Document::create([
                    'organization_id' => $organization->id,
                    'project_id' => $project->id,
                    'uploaded_by' => $request->user()->id,
                    'original_filename' => $file->getClientOriginalName(),
                    'storage_key' => $storageKey,
                    'checksum' => hash_file('sha256', $file->getRealPath()),
                    'mime_type' => 'application/pdf',
                    'size_bytes' => $file->getSize(),
                    'status' => 'processing',
                ]);
            }
        );

        ProcessDocumentJob::dispatch($document->id)->afterResponse();

        $this->auditLogger->logRequest($request, 'document.uploaded', 'document', $document->id);

        return response()->json(['data' => $document], 201);
    }

    public function show(Request $request, Document $document)
    {
        $this->authorize('view', $document);

        return response()->json(['data' => $document]);
    }

    public function update(Request $request, Document $document)
    {
        $this->authorize('update', $document);

        $data = $request->validate([
            'citation_metadata' => ['present', 'nullable', 'array'],
            'citation_metadata.author' => ['nullable', 'string', 'max:255'],
            'citation_metadata.title' => ['nullable', 'string', 'max:500'],
            'citation_metadata.year' => ['nullable', 'string', 'max:9'],
            'citation_metadata.publisher' => ['nullable', 'string', 'max:255'],
            'citation_metadata.url' => ['nullable', 'url', 'max:2048'],
        ]);

        $document->update($data);

        return response()->json(['data' => $document]);
    }

    public function page(Request $request, Document $document, int $page)
    {
        $this->authorize('view', $document);

        $documentPage = $document->pages()->where('page_number', $page)->firstOrFail();

        return response()->json(['data' => $documentPage]);
    }

    /**
     * Streams the original PDF bytes. Re-checks authorization on every call
     * rather than trusting a previously-issued link (docs/04 section 4.5:
     * "Document downloads must recheck authorization").
     */
    public function download(Request $request, Document $document)
    {
        $this->authorize('view', $document);

        if (! Storage::disk('local')->exists($document->storage_key)) {
            abort(404, 'File not found.');
        }

        return Storage::disk('local')->download($document->storage_key, $document->original_filename);
    }

    /**
     * BUG-003 fix: this used to delete the physical file immediately while
     * only soft-deleting the database row - so a "restored" document would
     * have no file left, and (separately) its excerpts/annotations stayed
     * fully active (see Document::booted() for that half of the fix). The
     * file now survives the retention window
     * (config('documents.retention_days')) so an accidental delete is
     * actually recoverable; permanent removal happens later in
     * PurgeSoftDeletedDocuments.
     */
    public function destroy(Request $request, Document $document)
    {
        $this->authorize('delete', $document);

        $document->delete();

        $this->auditLogger->logRequest($request, 'document.deleted', 'document', $document->id);

        return response()->json(['data' => ['message' => 'Document deleted.']]);
    }

    private function assertLooksLikePdf(string $path): void
    {
        $handle = fopen($path, 'rb');
        $header = $handle ? fread($handle, 5) : '';

        if ($handle) {
            fclose($handle);
        }

        if ($header !== '%PDF-') {
            throw ValidationException::withMessages([
                'file' => ['The uploaded file is not a valid PDF.'],
            ]);
        }
    }
}
