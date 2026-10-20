<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class WorkspaceItem extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'project_id', 'item_type', 'target_id', 'x', 'y', 'width', 'height', 'z_index',
    ];

    protected $casts = [
        'x' => 'float',
        'y' => 'float',
        'width' => 'float',
        'height' => 'float',
        'z_index' => 'integer',
    ];

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /** Resolve the underlying excerpt or note this canvas item represents. */
    public function target(): Excerpt|Note|null
    {
        return match ($this->item_type) {
            'excerpt' => Excerpt::find($this->target_id),
            'note' => Note::find($this->target_id),
            default => null,
        };
    }
}
