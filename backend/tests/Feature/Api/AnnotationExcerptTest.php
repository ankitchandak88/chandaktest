<?php

use App\Models\Annotation;
use App\Models\Excerpt;
use App\Models\Membership;
use App\Models\Project;
use App\Models\ProjectMember;

// BE-009
test('a user can create an annotation on a document', function () {
    ['headers' => $headers, 'user' => $user] = registerUser();
    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $headers)->json('data.id');
    $document = createReadyDocument(Project::find($projectId), $user->id);

    $response = apiPost("/api/v1/documents/{$document->id}/annotations", [
        'page_number' => 1,
        'type' => 'highlight',
        'color' => '#ffee00',
        'payload' => ['rects' => [['x' => 0.1, 'y' => 0.1, 'width' => 0.3, 'height' => 0.02]]],
    ], $headers);

    $response->assertCreated();
    expect(Annotation::count())->toBe(1);
});

// BE-010
test('a viewer on a project cannot modify another users annotation', function () {
    ['headers' => $headersA, 'user' => $userA, 'organization' => $organization] = registerUser('anno-a@example.test');

    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $headersA)->json('data.id');
    $project = Project::find($projectId);
    $document = createReadyDocument($project, $userA->id);

    // userB joins the same organization, but this project explicitly
    // restricts them to "viewer" via project_members (the "optional
    // project access" table - docs/03 section 3.1). Without an explicit
    // project_members row, any org member is a full editor by design; here
    // we exercise the restriction path, which is how "another user can't
    // modify my annotation" is actually enforced in this access model.
    ['user' => $userB] = registerUser('anno-b@example.test');
    Membership::create([
        'organization_id' => $organization->id,
        'user_id' => $userB->id,
        'role' => 'member',
    ]);
    ProjectMember::create([
        'project_id' => $project->id,
        'user_id' => $userB->id,
        'role' => 'viewer',
    ]);
    $tokenB = $userB->createToken('api')->plainTextToken;
    $headersB = ['Authorization' => "Bearer {$tokenB}", 'X-Organization-Id' => $organization->id];

    $annotation = Annotation::create([
        'document_id' => $document->id,
        'project_id' => $project->id,
        'created_by' => $userA->id,
        'page_number' => 1,
        'type' => 'comment',
        'comment_text' => 'original',
        'payload' => ['rects' => []],
    ]);

    apiPatch("/api/v1/annotations/{$annotation->id}", ['comment_text' => 'hijacked'], $headersB)
        ->assertStatus(403);

    expect($annotation->fresh()->comment_text)->toBe('original');
});

// BE-010 (cross-tenant variant)
test('a user in a different organization entirely cannot touch the annotation', function () {
    ['headers' => $headersA, 'user' => $userA] = registerUser('anno-c@example.test');
    ['headers' => $headersOutsider] = registerUser('anno-outsider@example.test');

    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $headersA)->json('data.id');
    $project = Project::find($projectId);
    $document = createReadyDocument($project, $userA->id);

    $annotation = Annotation::create([
        'document_id' => $document->id,
        'project_id' => $project->id,
        'created_by' => $userA->id,
        'page_number' => 1,
        'type' => 'comment',
        'comment_text' => 'original',
        'payload' => ['rects' => []],
    ]);

    apiPatch("/api/v1/annotations/{$annotation->id}", ['comment_text' => 'hijacked'], $headersOutsider)
        ->assertStatus(403);
});

// BE-011
test('saving an excerpt retains page and coordinates', function () {
    ['headers' => $headers, 'user' => $user] = registerUser();
    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $headers)->json('data.id');
    $document = createReadyDocument(Project::find($projectId), $user->id);

    $response = apiPost("/api/v1/projects/{$projectId}/excerpts", [
        'document_id' => $document->id,
        'page_number' => 3,
        'text' => 'Selected text from the source PDF',
        'source_rects' => [['x' => 0.12, 'y' => 0.28, 'width' => 0.54, 'height' => 0.04]],
    ], $headers);

    $response->assertCreated();
    expect($response->json('data.page_number'))->toBe(3);
    expect($response->json('data.source_rects.0.x'))->toBe(0.12);

    $excerpt = Excerpt::findOrFail($response->json('data.id'));
    expect($excerpt->page_number)->toBe(3);
});
