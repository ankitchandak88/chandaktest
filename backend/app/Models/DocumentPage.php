<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DocumentPage extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = ['document_id', 'page_number', 'text'];

    public function document(): BelongsTo
    {
        return $this->belongsTo(Document::class);
    }
}
