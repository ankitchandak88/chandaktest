<?php

namespace App\Models\Concerns;

use App\Models\Link;
use App\Models\WorkspaceItem;

/**
 * BUG-004 fix. `workspace_items` and `links` reference excerpts/notes via a
 * typed (item_type/target_id) pair rather than a real foreign key (docs/03
 * section 3.3: "validated polymorphic references" - deliberately not a raw
 * FK so the app controls which model types are acceptable). That means
 * nothing in the database cascades when an Excerpt or Note is deleted;
 * without this, a deleted excerpt/note left a visible orphan card on the
 * canvas and a dangling line for any link that pointed at it.
 *
 * Used by Excerpt and Note (anything that can be a workspace_item/link
 * endpoint). `$itemType` must match the `item_type`/`source_type`/
 * `target_type` enum value for that model ('excerpt' or 'note').
 */
trait CleansUpWorkspaceReferences
{
    protected static function bootCleansUpWorkspaceReferences(): void
    {
        static::deleting(function ($model) {
            if (method_exists($model, 'isForceDeleting') && $model->isForceDeleting()) {
                return;
            }

            $itemType = $model->workspaceItemType();

            WorkspaceItem::where('item_type', $itemType)
                ->where('target_id', $model->id)
                ->delete();

            Link::where(function ($query) use ($itemType, $model) {
                $query->where('source_type', $itemType)->where('source_id', $model->id);
            })->orWhere(function ($query) use ($itemType, $model) {
                $query->where('target_type', $itemType)->where('target_id', $model->id);
            })->delete();
        });
    }
}
