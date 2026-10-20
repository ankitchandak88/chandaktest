<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Project extends Model
{
    use HasFactory, HasUuids, SoftDeletes;

    protected $fillable = ['organization_id', 'created_by', 'name', 'description'];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function members(): HasMany
    {
        return $this->hasMany(ProjectMember::class);
    }

    public function documents(): HasMany
    {
        return $this->hasMany(Document::class);
    }

    public function notes(): HasMany
    {
        return $this->hasMany(Note::class);
    }

    public function excerpts(): HasMany
    {
        return $this->hasMany(Excerpt::class);
    }

    public function workspaceItems(): HasMany
    {
        return $this->hasMany(WorkspaceItem::class);
    }

    public function links(): HasMany
    {
        return $this->hasMany(Link::class);
    }

    public function exports(): HasMany
    {
        return $this->hasMany(Export::class);
    }
}
