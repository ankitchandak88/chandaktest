<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('project_shares', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('project_id')->constrained()->cascadeOnDelete();
            $table->foreignId('created_by')->constrained('users')->cascadeOnDelete();
            // Public identifier - never the uuid id, so revoking/looking one
            // up doesn't require exposing the row's primary key.
            $table->string('token', 64)->unique();
            $table->string('password_hash')->nullable();
            // Deliberately NOT nullable in practice (see
            // ShareController::store - always set, capped at
            // SHARE_LINK_MAX_DAYS) - a share link that never expires by
            // default was flagged as a real risk in the implementation
            // brief (Section 15: "share-link scope... expiry").
            $table->timestamp('expires_at');
            $table->timestamp('revoked_at')->nullable();
            $table->timestamp('last_accessed_at')->nullable();
            $table->timestamps();
            $table->index(['project_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('project_shares');
    }
};
