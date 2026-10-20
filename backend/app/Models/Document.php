<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Document extends Model
{
    use HasFactory, HasUuids, SoftDeletes;

    protected $fillable = [
        'organization_id', 'project_id', 'uploaded_by', 'original_filename',
        'storage_key', 'checksum', 'mime_type', 'size_bytes', 'page_count',
        'status', 'failure_reason', 'thumbnail_storage_key',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    public function uploader(): BelongsTo
    {
        return $this->belongsTo(User::class, 'uploaded_by');
    }

    public function pages(): HasMany
    {
        return $this->hasMany(DocumentPage::class)->orderBy('page_number');
    }

    public function annotations(): HasMany
    {
        return $this->hasMany(Annotation::class);
    }

    public function excerpts(): HasMany
    {
        return $this->hasMany(Excerpt::class);
    }

    public function isReady(): bool
    {
        return $this->status === 'ready';
    }
}
