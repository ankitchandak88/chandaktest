<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Project;
use App\Models\Workspace;
use Illuminate\Http\Request;

class WorkspaceController extends Controller
{
    public function index(Request $request, Project $project)
    {
        $this->authorize('view', $project);

        $workspaces = $project->workspaces()->withCount('items')->get();

        // Ensure at least one workspace exists for the project
        if ($workspaces->isEmpty()) {
            $default = $project->workspaces()->create([
                'name' => 'Main Board',
                'color' => '#3b82f6',
                'order_index' => 0,
            ]);
            $default->loadCount('items');
            $workspaces = collect([$default]);
        }

        return response()->json(['data' => $workspaces]);
    }

    public function store(Request $request, Project $project)
    {
        $this->authorize('update', $project);

        $data = $request->validate([
            'name' => ['required', 'string', 'max:100'],
            'color' => ['nullable', 'string', 'max:30'],
            'order_index' => ['nullable', 'integer'],
        ]);

        $maxOrder = $project->workspaces()->max('order_index') ?? -1;

        $workspace = $project->workspaces()->create([
            'name' => $data['name'],
            'color' => $data['color'] ?? '#3b82f6',
            'order_index' => $data['order_index'] ?? ($maxOrder + 1),
        ]);

        $workspace->loadCount('items');

        return response()->json(['data' => $workspace], 201);
    }

    public function update(Request $request, Workspace $workspace)
    {
        $this->authorize('update', $workspace->project);

        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:100'],
            'color' => ['sometimes', 'nullable', 'string', 'max:30'],
            'order_index' => ['sometimes', 'integer'],
        ]);

        $workspace->update($data);
        $workspace->loadCount('items');

        return response()->json(['data' => $workspace]);
    }

    public function destroy(Request $request, Workspace $workspace)
    {
        $this->authorize('update', $workspace->project);

        // Prevent deleting the only remaining board in a project
        if ($workspace->project->workspaces()->count() <= 1) {
            return response()->json([
                'message' => 'Cannot delete the only workspace board in a project.',
            ], 422);
        }

        $workspace->delete();

        return response()->json([
            'data' => ['message' => 'Workspace deleted successfully.'],
        ]);
    }
}
