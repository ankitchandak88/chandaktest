<?php

namespace App\Services\Billing;

/**
 * Normalized shape of a provider webhook payload after signature
 * verification, independent of Razorpay/Stripe/fake-specific field names.
 */
class WebhookEvent
{
    public function __construct(
        public readonly string $eventId,
        public readonly string $type,
        public readonly ?string $providerSubscriptionId,
        public readonly string $status,
        public readonly array $rawPayload,
    ) {
    }
}
