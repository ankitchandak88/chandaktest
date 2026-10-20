<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Document;
use App\Models\Excerpt;
use App\Models\Project;
use Illuminate\Http\Request;

class ExcerptController extends Controller
{
    public function index(Request $request, Project $project)
    {
        $this->authorize('view', $project);

        return response()->json(['data' => $project->excerpts()->orderByDesc('created_at')->paginate(30)]);
    }

    public function store(Request $request, Project $project)
    {
        $this->authorize('create', [Excerpt::class, $project]);

        $data = $request->validate([
            'document_id' => ['required', 'uuid', 'exists:documents,id'],
            'page_number' => ['required', 'integer', 'min:1'],
            'text' => ['required', 'string'],
            // Normalized (0-1) page rectangles - see docs/03 section 3.5.
            'source_rects' => ['required', 'array', 'min:1'],
            'source_rects.*.x' => ['required', 'numeric'],
            'source_rects.*.y' => ['required', 'numeric'],
            'source_rects.*.width' => ['required', 'numeric'],
            'source_rects.*.height' => ['required', 'numeric'],
        ]);

        $document = Document::findOrFail($data['document_id']);

        if ($document->project_id !== $project->id) {
            abort(422, 'Document does not belong to this project.');
        }

        $excerpt = Excerpt::create([
            'organization_id' => $project->organization_id,
            'project_id' => $project->id,
            'document_id' => $document->id,
            'created_by' => $request->user()->id,
            'page_number' => $data['page_number'],
            'text' => $data['text'],
            'source_rects' => $data['source_rects'],
        ]);

        return response()->json(['data' => $excerpt], 201);
    }

    public function update(Request $request, Excerpt $excerpt)
    {
        $this->authorize('update', $excerpt);

        $data = $request->validate([
            'text' => ['sometimes', 'string'],
            'source_rects' => ['sometimes', 'array', 'min:1'],
        ]);

        $excerpt->update($data);

        return response()->json(['data' => $excerpt]);
    }

    public function destroy(Request $request, Excerpt $excerpt)
    {
        $this->authorize('delete', $excerpt);

        $excerpt->delete();

        return response()->json(['data' => ['message' => 'Excerpt deleted.']]);
    }
}
