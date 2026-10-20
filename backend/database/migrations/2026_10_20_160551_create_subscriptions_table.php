<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('subscriptions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('plan_id')->constrained()->restrictOnDelete();
            $table->string('provider')->default('fake');
            $table->string('provider_subscription_id')->nullable();
            $table->enum('status', ['pending', 'trialing', 'active', 'past_due', 'canceled', 'expired'])->default('pending');
            $table->timestamp('current_period_end')->nullable();
            $table->boolean('cancel_at_period_end')->default(false);
            $table->timestamps();
            $table->unique(['provider', 'provider_subscription_id']);
            $table->index('organization_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('subscriptions');
    }
};
