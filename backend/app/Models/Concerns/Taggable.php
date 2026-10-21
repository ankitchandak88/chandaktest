<?php

namespace App\Models\Concerns;

use App\Models\Tag;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Support\Facades\DB;

/**
 * Used by Excerpt and Note (same `workspaceItemType()` string - 'excerpt' or
 * 'note' - already used by CleansUpWorkspaceReferences identifies which
 * model this is for the shared `taggables` pivot table).
 */
trait Taggable
{
    protected static function bootTaggable(): void
    {
        static::deleting(function ($model) {
            if (method_exists($model, 'isForceDeleting') && $model->isForceDeleting()) {
                return;
            }

            DB::table('taggables')
                ->where('taggable_type', $model->workspaceItemType())
                ->where('taggable_id', $model->id)
                ->delete();
        });
    }

    public function tags(): BelongsToMany
    {
        return $this->belongsToMany(Tag::class, 'taggables', 'taggable_id', 'tag_id')
            ->wherePivot('taggable_type', $this->workspaceItemType())
            ->withTimestamps();
    }

    /**
     * Replaces this item's tag set. $tagIds must already be validated as
     * belonging to the same project (see TagController::assertBelongsToProject
     * equivalent in ExcerptController/NoteController) - this method itself
     * does not re-check tenancy.
     */
    public function syncTags(array $tagIds): void
    {
        $taggableType = $this->workspaceItemType();

        $this->tags()->sync(
            collect($tagIds)->mapWithKeys(fn (string $tagId) => [
                $tagId => ['taggable_type' => $taggableType],
            ])->all()
        );
    }
}
