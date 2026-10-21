<?php

use Laravel\Sanctum\PersonalAccessToken;

// SEC-006 / REG: a bearer token issued longer ago than
// config('sanctum.expiration') minutes must stop authenticating, so a
// leaked/stolen token doesn't work forever.
test('a token older than the configured expiration is rejected', function () {
    ['headers' => $headers] = registerUser();

    apiGet('/api/v1/me', $headers)->assertOk();

    $tokenId = explode('|', str_replace('Bearer ', '', $headers['Authorization']))[0];
    PersonalAccessToken::where('id', $tokenId)->update([
        'created_at' => now()->subMinutes(config('sanctum.expiration') + 10),
    ]);

    apiGet('/api/v1/me', $headers)->assertStatus(401);
});

test('a token within the expiration window still works', function () {
    ['headers' => $headers] = registerUser();

    $tokenId = explode('|', str_replace('Bearer ', '', $headers['Authorization']))[0];
    PersonalAccessToken::where('id', $tokenId)->update([
        'created_at' => now()->subMinutes(config('sanctum.expiration') - 10),
    ]);

    apiGet('/api/v1/me', $headers)->assertOk();
});
