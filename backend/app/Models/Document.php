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

    /**
     * BUG-003 fix: soft-deleting a document used to leave its excerpts and
     * annotations fully visible and active (they don't cascade from a soft
     * delete the way a real `ON DELETE CASCADE` would from a hard delete).
     * Soft-deleting them too keeps them consistent with the document, and
     * each one's own `deleting` event (see Excerpt/Note) cleans up any
     * workspace_items/links that pointed at it - so a document delete
     * correctly ripples through the whole chain. The physical file and
     * `document_pages` rows are deliberately NOT touched here; see
     * App\Console\Commands\PurgeSoftDeletedDocuments for the retention-
     * window cleanup that removes them for good.
     */
    protected static function booted(): void
    {
        static::deleting(function (Document $document) {
            if ($document->isForceDeleting()) {
                return;
            }

            $document->excerpts()->get()->each->delete();
            $document->annotations()->get()->each->delete();
        });
    }
}
