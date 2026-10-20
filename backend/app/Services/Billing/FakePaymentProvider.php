<?php

namespace App\Services\Billing;

use App\Models\Organization;
use App\Models\Plan;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * Local/dev/test-only driver (PAYMENT_PROVIDER=fake). Simulates an instant
 * "checkout" and accepts a webhook authenticated with a shared secret
 * instead of real provider crypto, so the whole billing flow — checkout,
 * webhook, idempotent processing, subscription state — is exercisable
 * end-to-end before Razorpay keys exist. Never enable in production.
 */
class FakePaymentProvider implements PaymentProvider
{
    public function name(): string
    {
        return 'fake';
    }

    public function startCheckout(Organization $organization, Plan $plan): array
    {
        $subscriptionId = 'fake_sub_'.Str::uuid();

        return [
            'provider' => 'fake',
            'provider_subscription_id' => $subscriptionId,
            // In a real driver this is a hosted checkout URL. Here it points
            // straight at our own webhook so the flow can be tested locally
            // with `curl` (see docs/PROGRESS.md "Testing billing locally").
            'checkout_url' => route('billing.fake.simulate', ['subscriptionId' => $subscriptionId]),
        ];
    }

    public function verifyWebhookSignature(Request $request): bool
    {
        $expected = config('services.fake_payments.webhook_secret', 'fake-webhook-secret');

        return hash_equals($expected, (string) $request->header('X-Fake-Webhook-Secret'));
    }

    public function parseWebhookEvent(Request $request): WebhookEvent
    {
        $payload = $request->all();

        return new WebhookEvent(
            eventId: (string) ($payload['event_id'] ?? Str::uuid()),
            type: (string) ($payload['type'] ?? 'subscription.activated'),
            providerSubscriptionId: $payload['provider_subscription_id'] ?? null,
            status: (string) ($payload['status'] ?? 'active'),
            rawPayload: $payload,
        );
    }
}
