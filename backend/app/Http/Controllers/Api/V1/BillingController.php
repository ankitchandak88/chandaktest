<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\PaymentEvent;
use App\Models\Plan;
use App\Models\Subscription;
use App\Services\AuditLogger;
use App\Services\Billing\PaymentProvider;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class BillingController extends Controller
{
    public function __construct(
        private readonly PaymentProvider $paymentProvider,
        private readonly AuditLogger $auditLogger,
    ) {
    }

    public function plans()
    {
        return response()->json(['data' => Plan::where('active', true)->get()]);
    }

    public function subscription(Request $request)
    {
        $organization = $request->organization();
        $this->authorize('view', $organization);

        return response()->json(['data' => $organization->subscription()->with('plan')->first()]);
    }

    /**
     * Starts checkout but deliberately does NOT grant any entitlement yet
     * (docs/03 section 3.6: "Do not grant paid entitlements based solely on
     * a client redirect"). The subscription row is created in `pending`
     * status; only a verified webhook flips it to `active`.
     */
    public function checkout(Request $request)
    {
        $organization = $request->organization();
        $this->authorize('update', $organization);

        $data = $request->validate([
            'plan_code' => ['required', 'string', 'exists:plans,code'],
        ]);

        $plan = Plan::where('code', $data['plan_code'])->firstOrFail();

        $checkout = $this->paymentProvider->startCheckout($organization, $plan);

        $subscription = Subscription::create([
            'organization_id' => $organization->id,
            'plan_id' => $plan->id,
            'provider' => $checkout['provider'],
            'provider_subscription_id' => $checkout['provider_subscription_id'],
            'status' => 'pending',
        ]);

        $this->auditLogger->logRequest($request, 'billing.checkout_started', 'subscription', $subscription->id, [
            'plan_code' => $plan->code,
        ]);

        return response()->json([
            'data' => [
                'checkout_url' => $checkout['checkout_url'],
                'subscription_id' => $subscription->id,
            ],
        ]);
    }

    /**
     * Provider webhook endpoint (no auth:sanctum - the provider isn't a
     * logged-in user). Signature verification + a unique constraint on
     * (provider, provider_event_id) is what makes retries/duplicates safe
     * (docs/04 section 4.6, BE-015/BE-016).
     */
    public function webhook(Request $request, string $provider)
    {
        if ($provider !== $this->paymentProvider->name()) {
            abort(404);
        }

        if (! $this->paymentProvider->verifyWebhookSignature($request)) {
            Log::warning('Rejected webhook with invalid signature', ['provider' => $provider]);

            return response()->json(['message' => 'Invalid signature', 'errors' => (object) []], 400);
        }

        $event = $this->paymentProvider->parseWebhookEvent($request);

        $alreadyProcessed = PaymentEvent::where('provider', $provider)
            ->where('provider_event_id', $event->eventId)
            ->exists();

        if ($alreadyProcessed) {
            return response()->json(['data' => ['message' => 'Already processed.']]);
        }

        DB::transaction(function () use ($provider, $event) {
            PaymentEvent::create([
                'provider' => $provider,
                'provider_event_id' => $event->eventId,
                'status' => 'processed',
                'payload' => $event->rawPayload,
                'processed_at' => now(),
            ]);

            $subscription = Subscription::where('provider', $provider)
                ->where('provider_subscription_id', $event->providerSubscriptionId)
                ->lockForUpdate()
                ->first();

            if (! $subscription) {
                return;
            }

            $status = match ($event->status) {
                'active', 'paid', 'captured' => 'active',
                'past_due' => 'past_due',
                'canceled', 'cancelled' => 'canceled',
                'expired' => 'expired',
                default => $subscription->status,
            };

            $subscription->update([
                'status' => $status,
                'current_period_end' => $status === 'active' ? now()->addMonth() : $subscription->current_period_end,
            ]);

            $this->auditLogger->log(null, 'billing.webhook_processed', 'subscription', $subscription->id, [
                'provider' => $provider,
                'event_type' => $event->type,
                'new_status' => $status,
            ]);
        });

        return response()->json(['data' => ['message' => 'Processed.']]);
    }

    /**
     * Dev-only helper so the fake provider's "checkout" link has something
     * to redirect to locally; simulates the provider calling our own
     * webhook. Only registered when PAYMENT_PROVIDER=fake.
     */
    public function simulateFakeCheckout(Request $request, string $subscriptionId)
    {
        $subscription = Subscription::where('provider_subscription_id', $subscriptionId)->firstOrFail();

        return response()->json([
            'data' => [
                'message' => 'Use POST /api/v1/billing/webhooks/fake with header X-Fake-Webhook-Secret to activate this subscription.',
                'subscription_id' => $subscription->id,
                'provider_subscription_id' => $subscriptionId,
            ],
        ]);
    }
}
