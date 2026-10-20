<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class PaymentEvent extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = ['provider', 'provider_event_id', 'status', 'payload', 'processed_at'];

    protected $casts = [
        'payload' => 'array',
        'processed_at' => 'datetime',
    ];
}
