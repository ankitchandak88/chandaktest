<?php

namespace App\Services\Billing;

use App\Models\Organization;
use App\Models\Plan;
use Illuminate\Http\Request;

/**
 * Narrow contract every payment provider driver must satisfy, so billing
 * controllers/webhooks never branch on "which provider" directly.
 */
interface PaymentProvider
{
    /**
     * Start checkout for a plan and return a URL (or provider-specific
     * payload) the client should redirect to / render.
     */
    public function startCheckout(Organization $organization, Plan $plan): array;

    /**
     * Verify the webhook's signature against the raw request body. Must
     * return false (never throw) on a bad signature so the caller can
     * reject with 400 without leaking details.
     */
    public function verifyWebhookSignature(Request $request): bool;

    /**
     * Extract a stable (provider, event_id, event_type, payload) tuple from
     * an already-verified webhook request.
     */
    public function parseWebhookEvent(Request $request): WebhookEvent;

    public function name(): string;
}
