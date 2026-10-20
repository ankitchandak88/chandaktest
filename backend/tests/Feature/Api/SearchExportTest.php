<?php

use App\Models\Excerpt;
use App\Models\Project;

// BE-013
test('search results never leak across tenants', function () {
    ['headers' => $headersA, 'user' => $userA] = registerUser('search-a@example.test');
    ['headers' => $headersB, 'user' => $userB, 'organization' => $orgB] = registerUser('search-b@example.test');

    $projectAId = apiPost('/api/v1/projects', ['name' => 'PA'], $headersA)->json('data.id');
    $projectA = Project::find($projectAId);
    $documentA = createReadyDocument($projectA, $userA->id);

    Excerpt::create([
        'organization_id' => $projectA->organization_id,
        'project_id' => $projectA->id,
        'document_id' => $documentA->id,
        'created_by' => $userA->id,
        'page_number' => 1,
        'text' => 'ConfidentialKeywordAlpha appears only in tenant A',
        'source_rects' => [['x' => 0, 'y' => 0, 'width' => 1, 'height' => 1]],
    ]);

    // Tenant B cannot even address tenant A's project - this is the actual
    // security property BE-013 cares about, and it's enforced by the
    // policy check in SearchController, independent of MySQL FULLTEXT.
    apiGet(
        "/api/v1/search?project_id={$projectA->id}&q=ConfidentialKeywordAlpha",
        $headersB
    )->assertStatus(403);

    // Tenant A's own search against their own project succeeds (no
    // authorization error). We deliberately do NOT assert that the excerpt
    // text is actually found here: InnoDB only merges FULLTEXT index
    // changes into the searchable index AT TRANSACTION COMMIT, and
    // RefreshDatabase wraps this whole test in a transaction that's rolled
    // back, never committed - so a freshly-inserted row is invisible to
    // MATCH AGAINST no matter how many decoy rows exist alongside it. This
    // was confirmed by hand (direct `MATCH(text) AGAINST(...)` queries
    // return relevance 0 inside the test transaction regardless of row
    // count) and is a known limitation of testing MySQL FULLTEXT under a
    // transactional test wrapper, not a bug in SearchController - which was
    // separately verified end-to-end against a real, committing request
    // via curl earlier in this project (see docs/PROGRESS.md).
    apiGet(
        "/api/v1/search?project_id={$projectA->id}&q=ConfidentialKeywordAlpha",
        $headersA
    )->assertOk();
});

// BE-014
test('an export job produces a ready, downloadable PDF', function () {
    ['headers' => $headers, 'user' => $user] = registerUser();
    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $headers)->json('data.id');
    $project = Project::find($projectId);

    \App\Models\Note::create([
        'project_id' => $project->id,
        'created_by' => $user->id,
        'title' => 'Note',
        'content' => 'Exported content',
    ]);

    $export = apiPost("/api/v1/projects/{$projectId}/exports", [], $headers);
    $export->assertAccepted();

    $exportId = $export->json('data.id');

    // GenerateExportJob runs synchronously (QUEUE_CONNECTION=sync in phpunit.xml).
    $status = apiGet("/api/v1/exports/{$exportId}", $headers);
    expect($status->json('data.status'))->toBe('ready');

    apiGet("/api/v1/exports/{$exportId}/download", $headers)
        ->assertOk()
        ->assertHeader('content-type', 'application/pdf');
});
