<?php

use App\Models\Excerpt;
use App\Models\Membership;
use App\Models\Note;
use App\Models\Project;
use App\Models\ProjectShare;
use App\Models\User;

test('an owner can create a share link with a default expiry', function () {
    ['headers' => $headers] = registerUser();
    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $headers)->json('data.id');

    $response = apiPost("/api/v1/projects/{$projectId}/shares", [], $headers);

    $response->assertCreated();
    expect($response->json('data.token'))->not->toBeEmpty();
    expect($response->json('data.password_hash'))->toBeNull(); // $hidden must actually hide it
    expect($response->json('data'))->not->toHaveKey('password_hash');

    $share = ProjectShare::find($response->json('data.id'));
    expect($share->expires_at->isAfter(now()->addDays(6)))->toBeTrue();
});

test('a viewer-role project member cannot create a share link', function () {
    ['headers' => $ownerHeaders, 'organization' => $organization] = registerUser('share-owner@example.test');
    ['user' => $viewerUser] = registerUser('share-viewer@example.test');
    Membership::create(['organization_id' => $organization->id, 'user_id' => $viewerUser->id, 'role' => 'member']);
    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $ownerHeaders)->json('data.id');
    $project = Project::find($projectId);
    $project->members()->create(['user_id' => $viewerUser->id, 'role' => 'viewer']);

    $tokenForViewer = $viewerUser->createToken('api')->plainTextToken;
    $viewerHeaders = [
        'Authorization' => "Bearer {$tokenForViewer}",
        'X-Organization-Id' => $organization->id,
    ];

    apiPost("/api/v1/projects/{$projectId}/shares", [], $viewerHeaders)->assertStatus(403);
});

test('a user from another organization cannot create or revoke a share link', function () {
    ['headers' => $ownerHeaders] = registerUser('share-owner2@example.test');
    ['headers' => $outsiderHeaders] = registerUser('share-outsider2@example.test');
    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $ownerHeaders)->json('data.id');

    apiPost("/api/v1/projects/{$projectId}/shares", [], $outsiderHeaders)->assertStatus(403);

    $share = ProjectShare::create([
        'project_id' => $projectId,
        'created_by' => User::where('email', 'share-owner2@example.test')->value('id'),
        'token' => 'outsider-test-token',
        'expires_at' => now()->addDays(7),
    ]);
    apiDelete("/api/v1/shares/{$share->id}", [], $outsiderHeaders)->assertStatus(403);
});

test('the public endpoint returns compiled notes and excerpts but never a storage key or raw document data', function () {
    ['headers' => $headers, 'user' => $user] = registerUser();
    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $headers)->json('data.id');
    $project = Project::find($projectId);
    $document = createReadyDocument($project, $user->id);

    Excerpt::create([
        'organization_id' => $project->organization_id,
        'project_id' => $project->id,
        'document_id' => $document->id,
        'created_by' => $user->id,
        'page_number' => 1,
        'text' => 'shared excerpt text',
        'source_rects' => [['x' => 0, 'y' => 0, 'width' => 1, 'height' => 1]],
    ]);
    Note::create(['project_id' => $project->id, 'created_by' => $user->id, 'title' => 'T', 'content' => 'shared note content']);

    $share = apiPost("/api/v1/projects/{$projectId}/shares", [], $headers)->json('data');

    $showResponse = apiGet("/api/v1/shares/{$share['token']}");
    $showResponse->assertOk();
    expect($showResponse->json('data.requires_password'))->toBeFalse();
    expect($showResponse->json('data.project_name'))->toBe('P');

    $contentResponse = apiPost("/api/v1/shares/{$share['token']}/content");
    $contentResponse->assertOk();
    expect($contentResponse->json('data.excerpts.0.text'))->toBe('shared excerpt text');
    expect($contentResponse->json('data.notes.0.content'))->toBe('shared note content');

    $raw = $contentResponse->json();
    expect(json_encode($raw))->not->toContain('storage_key');
    expect(json_encode($raw))->not->toContain($document->storage_key);
});

test('a password-protected share link rejects a missing or wrong password and accepts the right one', function () {
    ['headers' => $headers] = registerUser();
    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $headers)->json('data.id');

    $share = apiPost("/api/v1/projects/{$projectId}/shares", ['password' => 'secret123'], $headers)->json('data');

    apiGet("/api/v1/shares/{$share['token']}")->assertOk()->assertJsonPath('data.requires_password', true);

    apiPost("/api/v1/shares/{$share['token']}/content")->assertStatus(403);
    apiPost("/api/v1/shares/{$share['token']}/content", ['password' => 'wrong'])->assertStatus(403);
    apiPost("/api/v1/shares/{$share['token']}/content", ['password' => 'secret123'])->assertOk();
});

test('an expired share link is not found, not distinguished from a nonexistent one', function () {
    ['headers' => $headers, 'user' => $user] = registerUser();
    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $headers)->json('data.id');

    $share = ProjectShare::create([
        'project_id' => $projectId,
        'created_by' => $user->id,
        'token' => 'expired-token-123',
        'expires_at' => now()->subDay(),
    ]);

    apiGet("/api/v1/shares/{$share->token}")->assertStatus(404);
    apiGet('/api/v1/shares/totally-made-up-token')->assertStatus(404);
});

test('revoking a share link makes it immediately inaccessible', function () {
    ['headers' => $headers] = registerUser();
    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $headers)->json('data.id');

    $share = apiPost("/api/v1/projects/{$projectId}/shares", [], $headers)->json('data');
    apiGet("/api/v1/shares/{$share['token']}")->assertOk();

    apiDelete("/api/v1/shares/{$share['id']}", [], $headers)->assertOk();

    apiGet("/api/v1/shares/{$share['token']}")->assertStatus(404);
});

test('expires_in_days is capped at the configured maximum', function () {
    ['headers' => $headers] = registerUser();
    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $headers)->json('data.id');

    apiPost("/api/v1/projects/{$projectId}/shares", ['expires_in_days' => 9999], $headers)
        ->assertStatus(422);
});
