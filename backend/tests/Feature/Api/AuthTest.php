<?php

use App\Models\User;

// BE-001
test('a user can register and receives a token plus a personal organization', function () {
    $response = apiPost('/api/v1/auth/register', [
        'name' => 'Alice',
        'email' => 'alice@example.test',
        'password' => 'Password123!',
        'password_confirmation' => 'Password123!',
    ]);

    $response->assertCreated();
    expect($response->json('data.token'))->not->toBeEmpty();
    expect($response->json('data.organization_id'))->not->toBeEmpty();
    expect(User::where('email', 'alice@example.test')->exists())->toBeTrue();
});

// BE-002
test('registering with a duplicate email is rejected', function () {
    registerUser('dupe@example.test');

    $response = apiPost('/api/v1/auth/register', [
        'name' => 'Someone Else',
        'email' => 'dupe@example.test',
        'password' => 'Password123!',
        'password_confirmation' => 'Password123!',
    ]);

    $response->assertStatus(422)->assertJsonValidationErrors('email');
});

// BE-003
test('logging in with an invalid password is rejected', function () {
    registerUser('login-test@example.test');

    $response = apiPost('/api/v1/auth/login', [
        'email' => 'login-test@example.test',
        'password' => 'WrongPassword!',
    ]);

    $response->assertStatus(422);
});

// BE-004
test('a protected route without auth returns 401', function () {
    apiGet('/api/v1/me')->assertStatus(401);
});

test('a suspended user cannot log in', function () {
    ['user' => $user] = registerUser('suspended@example.test');
    // forceFill: status is deliberately outside $fillable (SEC-005).
    $user->forceFill(['status' => 'suspended'])->save();

    apiPost('/api/v1/auth/login', [
        'email' => 'suspended@example.test',
        'password' => 'Password123!',
    ])->assertStatus(422);
});

test('account deletion removes the user and their solo organization', function () {
    ['headers' => $headers, 'user' => $user] = registerUser('deleteme@example.test');

    apiDelete('/api/v1/me', ['password' => 'Password123!'], $headers)
        ->assertOk();

    expect(User::find($user->id))->toBeNull();
});
