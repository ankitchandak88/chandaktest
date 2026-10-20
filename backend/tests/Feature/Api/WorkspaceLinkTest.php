<?php

use App\Models\Link;
use App\Models\Note;
use App\Models\Project;
use App\Models\WorkspaceItem;

test('workspace batch autosave persists positions for notes and excerpts', function () {
    ['headers' => $headers, 'user' => $user] = registerUser();
    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $headers)->json('data.id');
    $project = Project::find($projectId);

    $note = Note::create(['project_id' => $project->id, 'created_by' => $user->id, 'title' => 'N', 'content' => 'c']);

    $response = apiPost("/api/v1/projects/{$projectId}/workspace-items/batch", [
        'items' => [
            ['item_type' => 'note', 'target_id' => $note->id, 'x' => 120, 'y' => 240],
        ],
    ], $headers);

    $response->assertOk();
    expect(WorkspaceItem::where('target_id', $note->id)->first()->x)->toEqual(120);
});

// BE-012
test('linking to a nonexistent object is rejected', function () {
    ['headers' => $headers, 'user' => $user] = registerUser();
    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $headers)->json('data.id');

    $response = apiPost("/api/v1/projects/{$projectId}/links", [
        'source_type' => 'note',
        'source_id' => (string) \Illuminate\Support\Str::uuid(),
        'target_type' => 'note',
        'target_id' => (string) \Illuminate\Support\Str::uuid(),
    ], $headers);

    $response->assertStatus(422);
    expect(Link::count())->toBe(0);
});

test('a valid link between two project objects is created', function () {
    ['headers' => $headers, 'user' => $user] = registerUser();
    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $headers)->json('data.id');
    $project = Project::find($projectId);

    $noteA = Note::create(['project_id' => $project->id, 'created_by' => $user->id, 'content' => 'a']);
    $noteB = Note::create(['project_id' => $project->id, 'created_by' => $user->id, 'content' => 'b']);

    apiPost("/api/v1/projects/{$projectId}/links", [
        'source_type' => 'note',
        'source_id' => $noteA->id,
        'target_type' => 'note',
        'target_id' => $noteB->id,
    ], $headers)->assertCreated();

    expect(Link::count())->toBe(1);
});
