<?php

namespace App\Models;

use App\Models\Concerns\CleansUpWorkspaceReferences;
use App\Models\Concerns\Taggable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class Note extends Model
{
    use CleansUpWorkspaceReferences, HasFactory, HasUuids, SoftDeletes, Taggable;

    protected $fillable = ['project_id', 'created_by', 'title', 'content'];

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function workspaceItemType(): string
    {
        return 'note';
    }
}
