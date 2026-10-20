<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Annotation;
use App\Models\Document;
use Illuminate\Http\Request;

class AnnotationController extends Controller
{
    public function index(Request $request, Document $document)
    {
        $this->authorize('view', $document);

        return response()->json(['data' => $document->annotations()->orderBy('page_number')->get()]);
    }

    public function store(Request $request, Document $document)
    {
        $this->authorize('create', [Annotation::class, $document->project]);

        $data = $request->validate([
            'page_number' => ['required', 'integer', 'min:1'],
            'type' => ['required', 'in:highlight,underline,comment,ink'],
            'color' => ['nullable', 'string', 'max:16'],
            'comment_text' => ['nullable', 'string', 'max:5000'],
            // Normalized (0-1) rectangles/points on the page, so zoom changes
            // never break alignment (docs/03 section 3.3).
            'payload' => ['required', 'array'],
        ]);

        $annotation = Annotation::create([
            'document_id' => $document->id,
            'project_id' => $document->project_id,
            'created_by' => $request->user()->id,
            ...$data,
        ]);

        return response()->json(['data' => $annotation], 201);
    }

    public function update(Request $request, Annotation $annotation)
    {
        $this->authorize('update', $annotation);

        $data = $request->validate([
            'color' => ['sometimes', 'nullable', 'string', 'max:16'],
            'comment_text' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'payload' => ['sometimes', 'array'],
        ]);

        $annotation->update($data);

        return response()->json(['data' => $annotation]);
    }

    public function destroy(Request $request, Annotation $annotation)
    {
        $this->authorize('delete', $annotation);

        $annotation->delete();

        return response()->json(['data' => ['message' => 'Annotation deleted.']]);
    }
}
