<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Project;
use App\Models\WorkspaceItem;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class WorkspaceItemController extends Controller
{
    public function index(Request $request, Project $project)
    {
        $this->authorize('view', $project);

        return response()->json(['data' => $project->workspaceItems()->get()]);
    }

    public function store(Request $request, Project $project)
    {
        $this->authorize('create', [WorkspaceItem::class, $project]);

        $data = $this->validatedItem($request);

        $item = WorkspaceItem::create([
            'project_id' => $project->id,
            ...$data,
        ]);

        return response()->json(['data' => $item], 201);
    }

    public function update(Request $request, WorkspaceItem $workspaceItem)
    {
        $this->authorize('update', $workspaceItem);

        $data = $request->validate([
            'x' => ['sometimes', 'numeric'],
            'y' => ['sometimes', 'numeric'],
            'width' => ['sometimes', 'numeric'],
            'height' => ['sometimes', 'numeric'],
            'z_index' => ['sometimes', 'integer'],
        ]);

        $workspaceItem->update($data);

        return response()->json(['data' => $workspaceItem]);
    }

    public function destroy(Request $request, WorkspaceItem $workspaceItem)
    {
        $this->authorize('delete', $workspaceItem);

        $workspaceItem->delete();

        return response()->json(['data' => ['message' => 'Workspace item removed.']]);
    }

    /**
     * Bulk position upsert for the canvas autosave loop (docs/01 section 1.4
     * "Persist positions, zoom, and layout state" / docs/10 Phase 4). The
     * client debounces drag/resize events client-side and flushes a batch
     * here instead of one request per pixel of movement.
     */
    public function batch(Request $request, Project $project)
    {
        $this->authorize('update', $project);

        $data = $request->validate([
            'items' => ['required', 'array', 'max:200'],
            'items.*.id' => ['nullable', 'uuid'],
            'items.*.item_type' => ['required_without:items.*.id', 'in:excerpt,note'],
            'items.*.target_id' => ['required_without:items.*.id', 'uuid'],
            'items.*.x' => ['required', 'numeric'],
            'items.*.y' => ['required', 'numeric'],
            'items.*.width' => ['sometimes', 'numeric'],
            'items.*.height' => ['sometimes', 'numeric'],
            'items.*.z_index' => ['sometimes', 'integer'],
        ]);

        $saved = DB::transaction(function () use ($data, $project) {
            $results = [];

            foreach ($data['items'] as $itemData) {
                $attributes = collect($itemData)->only(['x', 'y', 'width', 'height', 'z_index'])->toArray();

                if (! empty($itemData['id'])) {
                    $item = $project->workspaceItems()->whereKey($itemData['id'])->first();

                    if ($item) {
                        $item->update($attributes);
                        $results[] = $item;

                        continue;
                    }
                }

                $results[] = WorkspaceItem::updateOrCreate(
                    [
                        'project_id' => $project->id,
                        'item_type' => $itemData['item_type'],
                        'target_id' => $itemData['target_id'],
                    ],
                    $attributes
                );
            }

            return $results;
        });

        return response()->json(['data' => $saved]);
    }

    private function validatedItem(Request $request): array
    {
        return $request->validate([
            'item_type' => ['required', 'in:excerpt,note'],
            'target_id' => ['required', 'uuid'],
            'x' => ['required', 'numeric'],
            'y' => ['required', 'numeric'],
            'width' => ['sometimes', 'numeric'],
            'height' => ['sometimes', 'numeric'],
            'z_index' => ['sometimes', 'integer'],
        ]);
    }
}
