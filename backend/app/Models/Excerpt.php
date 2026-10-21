<?php

namespace App\Models;

use App\Models\Concerns\CleansUpWorkspaceReferences;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class Excerpt extends Model
{
    use CleansUpWorkspaceReferences, HasFactory, HasUuids, SoftDeletes;

    protected $fillable = [
        'organization_id', 'project_id', 'document_id', 'created_by',
        'page_number', 'text', 'source_rects',
    ];

    protected $casts = [
        'source_rects' => 'array',
    ];

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    public function document(): BelongsTo
    {
        return $this->belongsTo(Document::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function workspaceItemType(): string
    {
        return 'excerpt';
    }
}
