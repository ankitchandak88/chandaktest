<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class Tag extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = ['project_id', 'name', 'color'];

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    public function excerpts(): BelongsToMany
    {
        return $this->belongsToMany(Excerpt::class, 'taggables', 'tag_id', 'taggable_id')
            ->wherePivot('taggable_type', 'excerpt')
            ->withTimestamps();
    }

    public function notes(): BelongsToMany
    {
        return $this->belongsToMany(Note::class, 'taggables', 'tag_id', 'taggable_id')
            ->wherePivot('taggable_type', 'note')
            ->withTimestamps();
    }
}
