<?php

use App\Models\Project;

test('a document has no citation strings until citation metadata is set', function () {
    ['headers' => $headers, 'user' => $user] = registerUser();
    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $headers)->json('data.id');
    $project = Project::find($projectId);
    $document = createReadyDocument($project, $user->id);

    $response = apiGet("/api/v1/documents/{$document->id}", $headers);
    $response->assertOk();
    expect($response->json('data.citation_apa'))->toBeNull();
    expect($response->json('data.citation_mla'))->toBeNull();
});

test('setting citation metadata produces apa and mla strings', function () {
    ['headers' => $headers, 'user' => $user] = registerUser();
    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $headers)->json('data.id');
    $project = Project::find($projectId);
    $document = createReadyDocument($project, $user->id);

    $response = apiPatch("/api/v1/documents/{$document->id}", [
        'citation_metadata' => [
            'author' => 'Smith, J',
            'title' => 'A Study of Things',
            'year' => '2020',
            'publisher' => 'Acme Press',
        ],
    ], $headers);

    $response->assertOk();
    expect($response->json('data.citation_apa'))
        ->toBe('Smith, J. (2020). A Study of Things. Acme Press.');
    expect($response->json('data.citation_mla'))
        ->toBe('Smith, J. "A Study of Things." Acme Press, 2020.');
});

test('a user in another organization cannot edit citation metadata', function () {
    ['headers' => $ownerHeaders, 'user' => $user] = registerUser('citation-owner@example.test');
    ['headers' => $outsiderHeaders] = registerUser('citation-outsider@example.test');
    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $ownerHeaders)->json('data.id');
    $project = Project::find($projectId);
    $document = createReadyDocument($project, $user->id);

    apiPatch("/api/v1/documents/{$document->id}", [
        'citation_metadata' => ['title' => 'Hijacked'],
    ], $outsiderHeaders)->assertStatus(403);
});

test('citation_metadata can be cleared back to null', function () {
    ['headers' => $headers, 'user' => $user] = registerUser();
    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $headers)->json('data.id');
    $project = Project::find($projectId);
    $document = createReadyDocument($project, $user->id);

    apiPatch("/api/v1/documents/{$document->id}", [
        'citation_metadata' => ['title' => 'Temp'],
    ], $headers)->assertOk();

    $response = apiPatch("/api/v1/documents/{$document->id}", [
        'citation_metadata' => null,
    ], $headers);

    $response->assertOk();
    expect($response->json('data.citation_apa'))->toBeNull();
});
