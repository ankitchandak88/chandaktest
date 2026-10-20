<?php

// BE-018
test('suspending a user revokes their access', function () {
    ['headers' => $headers, 'user' => $user] = registerUser();

    // A suspended user's API access is revoked: tokens are deleted and
    // future logins are rejected (mirrors what UserResource's "suspend"
    // Filament action does).
    $user->update([
        'status' => 'suspended',
        'suspended_reason' => 'Abuse report',
        'suspended_at' => now(),
    ]);
    $user->tokens()->delete();

    apiGet('/api/v1/me', $headers)->assertStatus(401);

    apiPost('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => 'Password123!',
    ])->assertStatus(422);
});

test('suspending an organization blocks access for all its members', function () {
    ['headers' => $headers, 'organization' => $organization] = registerUser();

    $organization->update(['status' => 'suspended', 'suspended_reason' => 'Non-payment']);

    apiGet('/api/v1/projects', $headers)->assertStatus(403);
});
