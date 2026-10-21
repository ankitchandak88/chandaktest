<?php

use App\Models\Annotation;
use App\Models\Document;
use App\Models\Excerpt;
use App\Models\Link;
use App\Models\Note;
use App\Models\Project;
use App\Models\WorkspaceItem;
use Illuminate\Support\Facades\Storage;

// BUG-003 / REG-008
test('deleting a document soft-deletes its excerpts and annotations too, and keeps the file for the retention window', function () {
    Storage::fake('local');

    ['headers' => $headers, 'user' => $user] = registerUser();
    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $headers)->json('data.id');
    $project = Project::find($projectId);
    $document = createReadyDocument($project, $user->id);
    Storage::disk('local')->put($document->storage_key, 'fake pdf bytes');

    $excerpt = Excerpt::create([
        'organization_id' => $project->organization_id,
        'project_id' => $project->id,
        'document_id' => $document->id,
        'created_by' => $user->id,
        'page_number' => 1,
        'text' => 'will be orphaned',
        'source_rects' => [['x' => 0, 'y' => 0, 'width' => 1, 'height' => 1]],
    ]);

    $annotation = Annotation::create([
        'document_id' => $document->id,
        'project_id' => $project->id,
        'created_by' => $user->id,
        'page_number' => 1,
        'type' => 'comment',
        'comment_text' => 'will be orphaned too',
        'payload' => ['rects' => []],
    ]);

    apiDelete("/api/v1/documents/{$document->id}", [], $headers)->assertOk();

    // No longer visible through the normal API...
    expect(Excerpt::find($excerpt->id))->toBeNull();
    expect(Annotation::find($annotation->id))->toBeNull();
    apiGet("/api/v1/projects/{$projectId}/excerpts", $headers)
        ->assertOk()
        ->assertJsonMissing(['text' => 'will be orphaned']);

    // ...but soft-deleted, not gone, and the file survives the retention window.
    expect(Excerpt::withTrashed()->find($excerpt->id))->not->toBeNull();
    expect(Annotation::withTrashed()->find($annotation->id))->not->toBeNull();
    expect(Document::withTrashed()->find($document->id))->not->toBeNull();
    Storage::disk('local')->assertExists($document->storage_key);
});

test('the purge command removes documents (and dependents) past the retention window, and leaves recent ones alone', function () {
    Storage::fake('local');

    ['headers' => $headers, 'user' => $user] = registerUser();
    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $headers)->json('data.id');
    $project = Project::find($projectId);

    $oldDocument = createReadyDocument($project, $user->id);
    Storage::disk('local')->put($oldDocument->storage_key, 'old pdf');
    $oldExcerpt = Excerpt::create([
        'organization_id' => $project->organization_id,
        'project_id' => $project->id,
        'document_id' => $oldDocument->id,
        'created_by' => $user->id,
        'page_number' => 1,
        'text' => 'old',
        'source_rects' => [['x' => 0, 'y' => 0, 'width' => 1, 'height' => 1]],
    ]);

    $recentDocument = createReadyDocument($project, $user->id);
    Storage::disk('local')->put($recentDocument->storage_key, 'recent pdf');

    apiDelete("/api/v1/documents/{$oldDocument->id}", [], $headers)->assertOk();
    apiDelete("/api/v1/documents/{$recentDocument->id}", [], $headers)->assertOk();

    // Backdate the old one past the retention window.
    Document::withTrashed()->where('id', $oldDocument->id)->update([
        'deleted_at' => now()->subDays((int) config('documents.retention_days') + 1),
    ]);

    $this->artisan('app:purge-soft-deleted-documents')->assertSuccessful();

    expect(Document::withTrashed()->find($oldDocument->id))->toBeNull();
    expect(Excerpt::withTrashed()->find($oldExcerpt->id))->toBeNull();
    Storage::disk('local')->assertMissing($oldDocument->storage_key);

    // The just-deleted one is untouched - still within its retention window.
    expect(Document::withTrashed()->find($recentDocument->id))->not->toBeNull();
    Storage::disk('local')->assertExists($recentDocument->storage_key);
});

// BUG-004 / REG-009 / REG-010
test('deleting an excerpt removes workspace items and links that referenced it, on either side', function () {
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
        'text' => 'linked excerpt',
        'source_rects' => [['x' => 0, 'y' => 0, 'width' => 1, 'height' => 1]],
    ]);
    $note = Note::create(['project_id' => $project->id, 'created_by' => $user->id, 'content' => 'linked note']);

    $card = WorkspaceItem::create([
        'project_id' => $project->id,
        'item_type' => 'excerpt',
        'target_id' => $excerpt->id,
        'x' => 10,
        'y' => 10,
    ]);

    $linkAsSource = Link::create([
        'project_id' => $project->id,
        'source_type' => 'excerpt',
        'source_id' => $excerpt->id,
        'target_type' => 'note',
        'target_id' => $note->id,
        'created_by' => $user->id,
    ]);
    $linkAsTarget = Link::create([
        'project_id' => $project->id,
        'source_type' => 'note',
        'source_id' => $note->id,
        'target_type' => 'excerpt',
        'target_id' => $excerpt->id,
        'created_by' => $user->id,
    ]);

    apiDelete("/api/v1/excerpts/{$excerpt->id}", [], $headers)->assertOk();

    expect(WorkspaceItem::find($card->id))->toBeNull();
    expect(Link::find($linkAsSource->id))->toBeNull();
    expect(Link::find($linkAsTarget->id))->toBeNull();
    // The unrelated note itself must survive.
    expect(Note::find($note->id))->not->toBeNull();
});

test('deleting a note removes workspace items and links that referenced it', function () {
    ['headers' => $headers, 'user' => $user] = registerUser();
    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $headers)->json('data.id');
    $project = Project::find($projectId);

    $noteA = Note::create(['project_id' => $project->id, 'created_by' => $user->id, 'content' => 'a']);
    $noteB = Note::create(['project_id' => $project->id, 'created_by' => $user->id, 'content' => 'b']);

    $card = WorkspaceItem::create([
        'project_id' => $project->id,
        'item_type' => 'note',
        'target_id' => $noteA->id,
        'x' => 0,
        'y' => 0,
    ]);
    $link = Link::create([
        'project_id' => $project->id,
        'source_type' => 'note',
        'source_id' => $noteA->id,
        'target_type' => 'note',
        'target_id' => $noteB->id,
        'created_by' => $user->id,
    ]);

    apiDelete("/api/v1/notes/{$noteA->id}", [], $headers)->assertOk();

    expect(WorkspaceItem::find($card->id))->toBeNull();
    expect(Link::find($link->id))->toBeNull();
    expect(Note::find($noteB->id))->not->toBeNull();
});
