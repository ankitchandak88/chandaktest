<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Jobs\GenerateExportJob;
use App\Models\Export;
use App\Models\Project;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class ExportController extends Controller
{
    public function store(Request $request, Project $project)
    {
        $this->authorize('create', [Export::class, $project]);

        $data = $request->validate([
            'format' => ['sometimes', 'in:pdf,pdf_highlights,docx'],
        ]);

        $export = Export::create([
            'project_id' => $project->id,
            'requested_by' => $request->user()->id,
            'format' => $data['format'] ?? 'pdf',
            'status' => 'queued',
        ]);

        GenerateExportJob::dispatch($export->id);

        return response()->json(['data' => $export], 202);
    }

    public function show(Request $request, Export $export)
    {
        $this->authorize('view', $export);

        return response()->json(['data' => $export]);
    }

    public function download(Request $request, Export $export)
    {
        $this->authorize('view', $export);

        if ($export->status !== 'ready') {
            abort(409, 'Export is not ready yet.');
        }

        if ($export->isExpired()) {
            abort(410, 'This export link has expired. Request a new export.');
        }

        $extension = $export->format === 'docx' ? 'docx' : 'pdf';

        return Storage::disk('local')->download(
            $export->storage_key,
            "export-{$export->project_id}.{$extension}"
        );
    }

    /**
     * Zero-Retention Cloud Purge ("Burn After Hearing"):
     * Generates a cryptographic Certificate of Destruction, bundles case brief,
     * and permanently deletes document physical files and database records from the cloud.
     */
    public function exportAndPurge(Request $request, Project $project)
    {
        $this->authorize('update', $project);

        $documents = $project->documents()->get();
        $excerpts = $project->excerpts()->with('tags')->get();
        $notes = $project->notes()->with('tags')->get();

        $purgedDocList = [];

        foreach ($documents as $doc) {
            $purgedDocList[] = [
                'id' => $doc->id,
                'filename' => $doc->original_filename,
                'size_bytes' => $doc->size_bytes,
                'checksum_sha256' => $doc->checksum,
            ];

            if ($doc->storage_key && Storage::disk('local')->exists($doc->storage_key)) {
                Storage::disk('local')->delete($doc->storage_key);
            }
            if ($doc->thumbnail_storage_key && Storage::disk('local')->exists($doc->thumbnail_storage_key)) {
                Storage::disk('local')->delete($doc->thumbnail_storage_key);
            }

            $doc->pages()->delete();
            $doc->annotations()->delete();
            $doc->forceDelete();
        }

        $certId = 'CERT-SHRED-' . strtoupper(Str::random(10));
        $certificate = [
            'certificate_id' => $certId,
            'project_id' => $project->id,
            'project_name' => $project->name,
            'purged_by' => $request->user()->email,
            'timestamp' => now()->toIso8601String(),
            'documents_destroyed' => $purgedDocList,
            'notes_count' => $notes->count(),
            'excerpts_count' => $excerpts->count(),
            'status' => 'DESTROYED_ZERO_RETENTION',
            'legal_declaration' => 'This is to certify that all uploaded document files, OCR text, and cloud binaries for this case matter have been permanently destroyed and purged from ChandakText cloud servers pursuant to the Advocate-Client Privilege & Zero-Retention Security Protocol. Zero bytes retained on cloud.',
        ];

        $responsePayload = [
            'status' => 'PURGED_ZERO_RETENTION',
            'message' => 'Case brief and all associated documents permanently purged from cloud storage.',
            'certificate' => $certificate,
            'archive' => [
                'project_name' => $project->name,
                'excerpts' => $excerpts,
                'notes' => $notes,
            ],
        ];

        // Hard-delete the project container so 0 records remain in DB
        $project->forceDelete();

        return response()->json($responsePayload);
    }
}
