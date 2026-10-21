<?php

use App\Models\Excerpt;
use App\Models\Note;
use App\Models\Project;
use App\Models\Tag;

function createProject(array $headers): Project
{
    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $headers)->json('data.id');

    return Project::find($projectId);
}

test('a project member can create a tag and list it', function () {
    ['headers' => $headers] = registerUser();
    $project = createProject($headers);

    $response = apiPost("/api/v1/projects/{$project->id}/tags", ['name' => 'Methodology', 'color' => '#22d3ee'], $headers);
    $response->assertCreated();
    expect($response->json('data.name'))->toBe('Methodology');

    apiGet("/api/v1/projects/{$project->id}/tags", $headers)
        ->assertOk()
        ->assertJsonFragment(['name' => 'Methodology']);
});

test('creating a duplicate tag name in the same project is rejected', function () {
    ['headers' => $headers] = registerUser();
    $project = createProject($headers);

    apiPost("/api/v1/projects/{$project->id}/tags", ['name' => 'Methodology'], $headers)->assertCreated();
    apiPost("/api/v1/projects/{$project->id}/tags", ['name' => 'Methodology'], $headers)->assertStatus(422);
});

test('a user from another organization cannot create, list, or delete tags on a project they do not belong to', function () {
    ['headers' => $headersA] = registerUser('tag-owner@example.test');
    ['headers' => $headersB] = registerUser('tag-outsider@example.test');
    $project = createProject($headersA);

    apiPost("/api/v1/projects/{$project->id}/tags", ['name' => 'Private'], $headersB)->assertStatus(403);
    apiGet("/api/v1/projects/{$project->id}/tags", $headersB)->assertStatus(403);

    $tag = Tag::create(['project_id' => $project->id, 'name' => 'Private']);
    apiDelete("/api/v1/tags/{$tag->id}", [], $headersB)->assertStatus(403);
});

test('syncing tags on an excerpt replaces its tag set and rejects tags from another project', function () {
    ['headers' => $headers, 'user' => $user] = registerUser();
    $project = createProject($headers);
    $otherProject = createProject($headers);
    $document = createReadyDocument($project, $user->id);

    $excerpt = Excerpt::create([
        'organization_id' => $project->organization_id,
        'project_id' => $project->id,
        'document_id' => $document->id,
        'created_by' => $user->id,
        'page_number' => 1,
        'text' => 'tagged excerpt',
        'source_rects' => [['x' => 0, 'y' => 0, 'width' => 1, 'height' => 1]],
    ]);

    $tagA = Tag::create(['project_id' => $project->id, 'name' => 'A']);
    $tagB = Tag::create(['project_id' => $project->id, 'name' => 'B']);
    $foreignTag = Tag::create(['project_id' => $otherProject->id, 'name' => 'Foreign']);

    // A tag belonging to a different project must be rejected.
    apiPut("/api/v1/excerpts/{$excerpt->id}/tags", ['tag_ids' => [$foreignTag->id]], $headers)
        ->assertStatus(422);

    apiPut("/api/v1/excerpts/{$excerpt->id}/tags", ['tag_ids' => [$tagA->id, $tagB->id]], $headers)
        ->assertOk();
    expect($excerpt->fresh()->tags()->pluck('name')->sort()->values()->all())->toBe(['A', 'B']);

    // Re-syncing with a smaller set replaces, not appends.
    apiPut("/api/v1/excerpts/{$excerpt->id}/tags", ['tag_ids' => [$tagA->id]], $headers)->assertOk();
    expect($excerpt->fresh()->tags()->pluck('name')->all())->toBe(['A']);
});

test('syncing tags on a note works the same way and is independent of excerpt tagging', function () {
    ['headers' => $headers, 'user' => $user] = registerUser();
    $project = createProject($headers);

    $note = Note::create(['project_id' => $project->id, 'created_by' => $user->id, 'content' => 'n']);
    $tag = Tag::create(['project_id' => $project->id, 'name' => 'Shared']);

    apiPut("/api/v1/notes/{$note->id}/tags", ['tag_ids' => [$tag->id]], $headers)->assertOk();

    expect($note->fresh()->tags()->pluck('name')->all())->toBe(['Shared']);
    expect($tag->fresh()->excerpts()->count())->toBe(0);
});

test('deleting a tag removes it from every excerpt and note it was attached to', function () {
    ['headers' => $headers, 'user' => $user] = registerUser();
    $project = createProject($headers);
    $document = createReadyDocument($project, $user->id);

    $excerpt = Excerpt::create([
        'organization_id' => $project->organization_id,
        'project_id' => $project->id,
        'document_id' => $document->id,
        'created_by' => $user->id,
        'page_number' => 1,
        'text' => 'e',
        'source_rects' => [['x' => 0, 'y' => 0, 'width' => 1, 'height' => 1]],
    ]);
    $tag = Tag::create(['project_id' => $project->id, 'name' => 'Removable']);
    $excerpt->syncTags([$tag->id]);

    apiDelete("/api/v1/tags/{$tag->id}", [], $headers)->assertOk();

    expect($excerpt->fresh()->tags()->count())->toBe(0);
    expect(\DB::table('taggables')->where('tag_id', $tag->id)->count())->toBe(0);
});

test('deleting an excerpt cleans up its tag associations', function () {
    ['headers' => $headers, 'user' => $user] = registerUser();
    $project = createProject($headers);
    $document = createReadyDocument($project, $user->id);

    $excerpt = Excerpt::create([
        'organization_id' => $project->organization_id,
        'project_id' => $project->id,
        'document_id' => $document->id,
        'created_by' => $user->id,
        'page_number' => 1,
        'text' => 'e',
        'source_rects' => [['x' => 0, 'y' => 0, 'width' => 1, 'height' => 1]],
    ]);
    $tag = Tag::create(['project_id' => $project->id, 'name' => 'T']);
    $excerpt->syncTags([$tag->id]);

    apiDelete("/api/v1/excerpts/{$excerpt->id}", [], $headers)->assertOk();

    expect(\DB::table('taggables')->where('taggable_type', 'excerpt')->where('taggable_id', $excerpt->id)->count())
        ->toBe(0);
    // The tag itself survives - only the association is cleaned up.
    expect(Tag::find($tag->id))->not->toBeNull();
});
