<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Note;
use App\Models\Project;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class NoteController extends Controller
{
    public function index(Request $request, Project $project)
    {
        $this->authorize('view', $project);

        // See DocumentController::index() - not double-wrapped.
        return response()->json(
            $project->notes()->with('tags')->orderByDesc('created_at')->paginate(30)
        );
    }

    public function store(Request $request, Project $project)
    {
        $this->authorize('create', [Note::class, $project]);

        $data = $request->validate([
            'title' => ['nullable', 'string', 'max:255'],
            'content' => ['nullable', 'string'],
        ]);

        $note = Note::create([
            'project_id' => $project->id,
            'created_by' => $request->user()->id,
            'title' => $data['title'] ?? null,
            'content' => $data['content'] ?? null,
        ]);

        return response()->json(['data' => $note], 201);
    }

    public function update(Request $request, Note $note)
    {
        $this->authorize('update', $note);

        $data = $request->validate([
            'title' => ['sometimes', 'nullable', 'string', 'max:255'],
            'content' => ['sometimes', 'nullable', 'string'],
        ]);

        $note->update($data);

        return response()->json(['data' => $note]);
    }

    public function destroy(Request $request, Note $note)
    {
        $this->authorize('delete', $note);

        $note->delete();

        return response()->json(['data' => ['message' => 'Note deleted.']]);
    }

    public function syncTags(Request $request, Note $note)
    {
        $this->authorize('update', $note);

        $data = $request->validate([
            'tag_ids' => ['present', 'array'],
            'tag_ids.*' => [
                'uuid',
                Rule::exists('tags', 'id')->where('project_id', $note->project_id),
            ],
        ]);

        $note->syncTags($data['tag_ids']);

        return response()->json(['data' => $note->load('tags')]);
    }
}
