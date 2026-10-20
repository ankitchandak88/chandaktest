<?php

use App\Models\Plan;
use App\Models\Project;

// BE-005
test('a user cannot access another tenants project', function () {
    ['headers' => $headersA] = registerUser('tenant-a@example.test');
    ['organization' => $orgB] = registerUser('tenant-b@example.test');

    $project = Project::factory()->create([
        'organization_id' => $orgB->id,
        'created_by' => $orgB->memberships()->first()->user_id,
    ]);

    apiGet("/api/v1/projects/{$project->id}", $headersA)->assertStatus(403);
});

test('a user can create and view their own project', function () {
    ['headers' => $headers] = registerUser();

    $create = apiPost('/api/v1/projects', ['name' => 'Research One'], $headers);
    $create->assertCreated();

    $projectId = $create->json('data.id');

    apiGet("/api/v1/projects/{$projectId}", $headers)
        ->assertOk()
        ->assertJsonPath('data.name', 'Research One');
});

// BE-008 / BE-017
test('creating a project beyond the plan limit is rejected and quota stays correct', function () {
    ['headers' => $headers, 'organization' => $organization] = registerUser();

    Plan::where('code', 'free')->update(['limits' => ['projects' => 1, 'storage_mb' => 500, 'documents_per_project' => 10]]);

    apiPost('/api/v1/projects', ['name' => 'First'], $headers)->assertCreated();

    $second = apiPost('/api/v1/projects', ['name' => 'Second'], $headers);
    $second->assertStatus(402);

    expect($organization->fresh()->projects()->count())->toBe(1);
});
