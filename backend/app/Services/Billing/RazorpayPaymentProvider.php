<?php

namespace App\Services\Billing;

use App\Models\Organization;
use App\Models\Plan;
use Illuminate\Http\Request;
use Razorpay\Api\Api;

/**
 * PAYMENT_PROVIDER=razorpay. Uses Razorpay Payment Links for checkout (no
 * card data ever touches our servers) and verifies webhooks per Razorpay's
 * documented HMAC-SHA256 scheme over the *raw* request body (docs/04 section
 * 4.6: "Read the exact request body required by the provider's signature
 * scheme"). Requires RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET /
 * RAZORPAY_WEBHOOK_SECRET to be configured — until then this driver is
 * wired but unused (PAYMENT_PROVIDER defaults to `fake`).
 */
class RazorpayPaymentProvider implements PaymentProvider
{
    private Api $api;

    public function __construct()
    {
        $this->api = new Api(
            config('services.razorpay.key'),
            config('services.razorpay.secret'),
        );
    }

    public function name(): string
    {
        return 'razorpay';
    }

    public function startCheckout(Organization $organization, Plan $plan): array
    {
        $paymentLink = $this->api->paymentLink->create([
            'amount' => $plan->price_inr_paise,
            'currency' => 'INR',
            'description' => "ChandakText — {$plan->name} plan",
            'notes' => [
                'organization_id' => $organization->id,
                'plan_id' => $plan->id,
            ],
            'callback_url' => config('app.frontend_url').'/billing/return',
            'callback_method' => 'get',
        ]);

        return [
            'provider' => 'razorpay',
            'provider_subscription_id' => $paymentLink['id'],
            'checkout_url' => $paymentLink['short_url'],
        ];
    }

    public function verifyWebhookSignature(Request $request): bool
    {
        $secret = config('services.razorpay.webhook_secret');

        if (! $secret) {
            return false;
        }

        $signature = (string) $request->header('X-Razorpay-Signature');
        $expected = hash_hmac('sha256', $request->getContent(), $secret);

        return hash_equals($expected, $signature);
    }

    public function parseWebhookEvent(Request $request): WebhookEvent
    {
        $payload = $request->json()->all();
        $entity = $payload['payload']['payment_link']['entity']
            ?? $payload['payload']['subscription']['entity']
            ?? [];

        return new WebhookEvent(
            eventId: (string) ($payload['event'].':'.($entity['id'] ?? uniqid())),
            type: (string) ($payload['event'] ?? 'unknown'),
            providerSubscriptionId: $entity['id'] ?? null,
            status: (string) ($entity['status'] ?? 'active'),
            rawPayload: $payload,
        );
    }
}
