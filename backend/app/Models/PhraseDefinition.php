<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PhraseDefinition extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'project_id',
        'document_id',
        'term',
        'definition',
        'page_number',
        'source_rects',
    ];

    protected $casts = [
        'page_number' => 'integer',
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
}
