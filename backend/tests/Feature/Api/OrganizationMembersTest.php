<?php

use App\Models\Membership;

test('an owner can add an existing user to the organization', function () {
    ['headers' => $ownerHeaders, 'organization' => $organization] = registerUser('org-owner@example.test');
    ['user' => $invitee] = registerUser('org-invitee@example.test');

    $response = apiPost('/api/v1/organizations/current/members', [
        'email' => $invitee->email,
        'role' => 'member',
    ], $ownerHeaders);

    $response->assertCreated();
    expect(Membership::where('organization_id', $organization->id)->where('user_id', $invitee->id)->exists())
        ->toBeTrue();
});

test('adding a member who has not registered yet is rejected', function () {
    ['headers' => $ownerHeaders] = registerUser('org-owner2@example.test');

    apiPost('/api/v1/organizations/current/members', [
        'email' => 'nobody-has-this-account@example.test',
        'role' => 'member',
    ], $ownerHeaders)->assertStatus(422);
});

test('a non-owner member cannot add members', function () {
    ['headers' => $ownerHeaders, 'organization' => $organization] = registerUser('org-owner3@example.test');
    ['user' => $memberUser] = registerUser('org-member3@example.test');
    ['user' => $thirdUser] = registerUser('org-third3@example.test');

    Membership::create([
        'organization_id' => $organization->id,
        'user_id' => $memberUser->id,
        'role' => 'member',
    ]);

    $tokenForMember = $memberUser->createToken('api')->plainTextToken;
    $memberHeaders = [
        'Authorization' => "Bearer {$tokenForMember}",
        'X-Organization-Id' => $organization->id,
    ];

    apiPost('/api/v1/organizations/current/members', [
        'email' => $thirdUser->email,
        'role' => 'member',
    ], $memberHeaders)->assertStatus(403);

    unset($ownerHeaders);
});

test('removing the last owner is rejected', function () {
    ['headers' => $ownerHeaders, 'organization' => $organization, 'user' => $owner] = registerUser('org-owner4@example.test');

    $ownMembership = Membership::where('organization_id', $organization->id)
        ->where('user_id', $owner->id)
        ->firstOrFail();

    apiDelete("/api/v1/organizations/members/{$ownMembership->id}", [], $ownerHeaders)
        ->assertStatus(409);

    expect(Membership::find($ownMembership->id))->not->toBeNull();
});

// BUG-005
test('re-adding an existing member with a different role actually updates the role', function () {
    ['headers' => $ownerHeaders, 'organization' => $organization] = registerUser('org-owner5@example.test');
    ['user' => $member] = registerUser('org-member5@example.test');

    Membership::create(['organization_id' => $organization->id, 'user_id' => $member->id, 'role' => 'member']);

    $response = apiPost('/api/v1/organizations/current/members', [
        'email' => $member->email,
        'role' => 'owner',
    ], $ownerHeaders);

    // Updating an existing membership is a 200, not a 201 "created".
    $response->assertOk();
    expect($response->json('data.role'))->toBe('owner');
    expect(
        Membership::where('organization_id', $organization->id)->where('user_id', $member->id)->value('role')
    )->toBe('owner');
});

test('demoting the sole owner through the add-member endpoint is rejected', function () {
    ['headers' => $ownerHeaders, 'organization' => $organization, 'user' => $owner] = registerUser('org-owner6@example.test');

    apiPost('/api/v1/organizations/current/members', [
        'email' => $owner->email,
        'role' => 'member',
    ], $ownerHeaders)->assertStatus(409);

    expect(
        Membership::where('organization_id', $organization->id)->where('user_id', $owner->id)->value('role')
    )->toBe('owner');
});
