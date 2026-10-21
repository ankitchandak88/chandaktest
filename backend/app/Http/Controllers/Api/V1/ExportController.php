<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Jobs\GenerateExportJob;
use App\Models\Export;
use App\Models\Project;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

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
}
