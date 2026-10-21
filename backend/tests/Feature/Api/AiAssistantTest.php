<?php

use App\Models\Excerpt;
use App\Models\Note;
use App\Models\Project;

test('summarizing a document caches the result and a repeat call reuses it', function () {
    ['headers' => $headers, 'user' => $user] = registerUser();
    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $headers)->json('data.id');
    $project = Project::find($projectId);
    $document = createReadyDocument($project, $user->id);
    $document->pages()->create(['page_number' => 1, 'text' => 'Some extracted page text about X.']);

    $first = apiPost("/api/v1/documents/{$document->id}/summarize", [], $headers);
    $first->assertOk();
    $summary = $first->json('data.summary');
    expect($summary)->not->toBeEmpty();
    expect($document->fresh()->ai_summary)->toBe($summary);

    // Change the underlying page text - without force, the cached value
    // must still come back unchanged.
    $document->pages()->first()->update(['text' => 'Completely different text now.']);
    $second = apiPost("/api/v1/documents/{$document->id}/summarize", [], $headers);
    expect($second->json('data.summary'))->toBe($summary);

    $forced = apiPost("/api/v1/documents/{$document->id}/summarize", ['force' => true], $headers);
    expect($forced->json('data.summary'))->not->toBe($summary);
});

test('a user from another organization cannot summarize or chat about a document', function () {
    ['headers' => $ownerHeaders, 'user' => $user] = registerUser('ai-owner@example.test');
    ['headers' => $outsiderHeaders] = registerUser('ai-outsider@example.test');
    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $ownerHeaders)->json('data.id');
    $project = Project::find($projectId);
    $document = createReadyDocument($project, $user->id);

    apiPost("/api/v1/documents/{$document->id}/summarize", [], $outsiderHeaders)->assertStatus(403);
    apiPost("/api/v1/documents/{$document->id}/chat", ['message' => 'hi'], $outsiderHeaders)->assertStatus(403);
});

test('chat requires a message and returns a reply', function () {
    ['headers' => $headers, 'user' => $user] = registerUser();
    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $headers)->json('data.id');
    $project = Project::find($projectId);
    $document = createReadyDocument($project, $user->id);
    $document->pages()->create(['page_number' => 1, 'text' => 'Context text.']);

    apiPost("/api/v1/documents/{$document->id}/chat", [], $headers)->assertStatus(422);

    $response = apiPost("/api/v1/documents/{$document->id}/chat", ['message' => 'What is this about?'], $headers);
    $response->assertOk();
    expect($response->json('data.reply'))->toContain('What is this about?');
});

test('suggest-tags on an excerpt returns suggestions without modifying its tags', function () {
    ['headers' => $headers, 'user' => $user] = registerUser();
    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $headers)->json('data.id');
    $project = Project::find($projectId);
    $document = createReadyDocument($project, $user->id);

    $excerpt = Excerpt::create([
        'organization_id' => $project->organization_id,
        'project_id' => $project->id,
        'document_id' => $document->id,
        'created_by' => $user->id,
        'page_number' => 1,
        'text' => 'This excerpt discusses methodology methodology methodology at length.',
        'source_rects' => [['x' => 0, 'y' => 0, 'width' => 1, 'height' => 1]],
    ]);

    $response = apiPost("/api/v1/excerpts/{$excerpt->id}/suggest-tags", [], $headers);
    $response->assertOk();
    expect($response->json('data.suggestions'))->toBeArray();
    expect($excerpt->fresh()->tags()->count())->toBe(0);
});

test('suggest-tags on a note works the same way', function () {
    ['headers' => $headers, 'user' => $user] = registerUser();
    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $headers)->json('data.id');
    $project = Project::find($projectId);

    $note = Note::create([
        'project_id' => $project->id,
        'created_by' => $user->id,
        'content' => 'Notes about consensus consensus consensus protocols.',
    ]);

    apiPost("/api/v1/notes/{$note->id}/suggest-tags", [], $headers)
        ->assertOk()
        ->assertJsonStructure(['data' => ['suggestions']]);
});
