<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Excerpt;
use App\Models\Link;
use App\Models\Note;
use App\Models\Project;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class LinkController extends Controller
{
    public function index(Request $request, Project $project)
    {
        $this->authorize('view', $project);

        return response()->json(['data' => $project->links()->get()]);
    }

    public function store(Request $request, Project $project)
    {
        $this->authorize('create', [Link::class, $project]);

        $data = $request->validate([
            'source_type' => ['required', 'in:excerpt,note,document'],
            'source_id' => ['required', 'uuid'],
            'target_type' => ['required', 'in:excerpt,note,document'],
            'target_id' => ['required', 'uuid'],
            'label' => ['nullable', 'string', 'max:255'],
        ]);

        // Validated polymorphic references (docs/03 section 3.3): never
        // trust the client's type string without confirming the row exists
        // and actually belongs to this project.
        $this->assertBelongsToProject($project, $data['source_type'], $data['source_id']);
        $this->assertBelongsToProject($project, $data['target_type'], $data['target_id']);

        $link = Link::create([
            'project_id' => $project->id,
            'created_by' => $request->user()->id,
            ...$data,
        ]);

        return response()->json(['data' => $link], 201);
    }

    public function destroy(Request $request, Link $link)
    {
        $this->authorize('delete', $link);

        $link->delete();

        return response()->json(['data' => ['message' => 'Link deleted.']]);
    }

    private function assertBelongsToProject(Project $project, string $type, string $id): void
    {
        $model = match ($type) {
            'excerpt' => Excerpt::where('project_id', $project->id)->whereKey($id)->first(),
            'note' => Note::where('project_id', $project->id)->whereKey($id)->first(),
            'document' => Document::where('project_id', $project->id)->whereKey($id)->first(),
            default => null,
        };

        if (! $model) {
            throw ValidationException::withMessages([
                $type => ["The referenced {$type} does not exist in this project."],
            ]);
        }
    }
}
