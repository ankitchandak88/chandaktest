<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Plan extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = ['code', 'name', 'limits', 'features', 'price_inr_paise', 'active'];

    protected $casts = [
        'limits' => 'array',
        'features' => 'array',
        'active' => 'boolean',
    ];

    public function subscriptions(): HasMany
    {
        return $this->hasMany(Subscription::class);
    }

    public function limit(string $key, int $default = 0): int
    {
        return (int) ($this->limits[$key] ?? $default);
    }
}
