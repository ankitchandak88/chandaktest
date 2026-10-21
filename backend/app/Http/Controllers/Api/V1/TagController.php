<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Project;
use App\Models\Tag;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class TagController extends Controller
{
    public function index(Request $request, Project $project)
    {
        $this->authorize('view', $project);

        return response()->json(['data' => $project->tags()->orderBy('name')->get()]);
    }

    public function store(Request $request, Project $project)
    {
        $this->authorize('create', [Tag::class, $project]);

        $data = $request->validate([
            'name' => [
                'required', 'string', 'max:255',
                Rule::unique('tags')->where('project_id', $project->id),
            ],
            'color' => ['nullable', 'string', 'max:32'],
        ]);

        $tag = Tag::create([
            'project_id' => $project->id,
            ...$data,
        ]);

        return response()->json(['data' => $tag], 201);
    }

    public function destroy(Request $request, Tag $tag)
    {
        $this->authorize('delete', $tag);

        $tag->delete();

        return response()->json(['data' => ['message' => 'Tag deleted.']]);
    }
}
