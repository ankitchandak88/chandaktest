<?php

use App\Models\PaymentEvent;
use App\Models\Subscription;

// BE-016
test('a webhook with an invalid signature is rejected', function () {
    apiPost('/api/v1/billing/webhooks/fake', [
        'event_id' => 'evt-bad-sig',
        'provider_subscription_id' => 'fake_sub_whatever',
        'status' => 'active',
    ], ['X-Fake-Webhook-Secret' => 'totally-wrong-secret'])
        ->assertStatus(400);

    expect(PaymentEvent::count())->toBe(0);
});

// BE-015
test('a duplicate payment webhook does not double-process', function () {
    ['headers' => $headers] = registerUser();

    $checkout = apiPost('/api/v1/billing/checkout', ['plan_code' => 'pro'], $headers);
    $checkout->assertOk();
    $subscriptionId = $checkout->json('data.subscription_id');
    $providerSubId = Subscription::findOrFail($subscriptionId)->provider_subscription_id;

    $payload = [
        'event_id' => 'evt-once',
        'provider_subscription_id' => $providerSubId,
        'status' => 'active',
    ];

    apiPost('/api/v1/billing/webhooks/fake', $payload, fakeWebhookHeaders())->assertOk();
    expect(Subscription::findOrFail($subscriptionId)->status)->toBe('active');

    // Replay the identical event.
    apiPost('/api/v1/billing/webhooks/fake', $payload, fakeWebhookHeaders())->assertOk();

    expect(PaymentEvent::where('provider_event_id', 'evt-once')->count())->toBe(1);
});

test('a subscription stays pending until a verified webhook confirms it', function () {
    ['headers' => $headers, 'organization' => $organization] = registerUser();

    apiPost('/api/v1/billing/checkout', ['plan_code' => 'pro'], $headers)->assertOk();

    $subscription = Subscription::where('organization_id', $organization->id)->firstOrFail();
    expect($subscription->status)->toBe('pending');
    expect($subscription->isActive())->toBeFalse();
});
