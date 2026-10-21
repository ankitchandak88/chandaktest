<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Hash;

class ProjectShare extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'project_id', 'created_by', 'token', 'password_hash', 'expires_at', 'revoked_at', 'last_accessed_at',
    ];

    protected $hidden = ['password_hash'];

    protected $casts = [
        'expires_at' => 'datetime',
        'revoked_at' => 'datetime',
        'last_accessed_at' => 'datetime',
    ];

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function isActive(): bool
    {
        return $this->revoked_at === null && ! $this->expires_at->isPast();
    }

    public function requiresPassword(): bool
    {
        return $this->password_hash !== null;
    }

    public function verifyPassword(string $plain): bool
    {
        return $this->password_hash !== null && Hash::check($plain, $this->password_hash);
    }
}
