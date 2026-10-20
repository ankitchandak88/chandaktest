<?php

use App\Models\Plan;
use App\Models\Project;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Queue;

// BE-006
test('a valid pdf upload creates a private processing document', function () {
    Queue::fake();

    ['headers' => $headers, 'organization' => $organization] = registerUser();
    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $headers)->json('data.id');

    $file = UploadedFile::fake()->createWithContent('sample.pdf', minimalPdfBytes());

    $response = apiPost("/api/v1/projects/{$projectId}/documents", ['file' => $file], $headers);

    $response->assertCreated();
    expect($response->json('data.status'))->toBe('processing');
    expect($response->json('data.organization_id'))->toBe($organization->id);

    Queue::assertPushed(App\Jobs\ProcessDocumentJob::class);
});

// BE-007
test('a non-pdf file renamed to .pdf is rejected', function () {
    ['headers' => $headers] = registerUser();
    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $headers)->json('data.id');

    $file = UploadedFile::fake()->createWithContent('malware.pdf', "MZ\x90\x00this is actually an executable, not a pdf");

    apiPost("/api/v1/projects/{$projectId}/documents", ['file' => $file], $headers)
        ->assertStatus(422);
});

// BE-008 (documents-per-project + storage variant)
test('uploading beyond the per-project document limit is rejected', function () {
    Queue::fake();

    ['headers' => $headers] = registerUser();
    Plan::where('code', 'free')->update(['limits' => ['projects' => 3, 'storage_mb' => 500, 'documents_per_project' => 1]]);

    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $headers)->json('data.id');

    $file = fn () => UploadedFile::fake()->createWithContent('sample.pdf', minimalPdfBytes());

    apiPost("/api/v1/projects/{$projectId}/documents", ['file' => $file()], $headers)->assertCreated();
    apiPost("/api/v1/projects/{$projectId}/documents", ['file' => $file()], $headers)->assertStatus(402);

    expect(Project::find($projectId)->documents()->count())->toBe(1);
});

// BE-019
test('deleting a document revokes access to it', function () {
    Queue::fake();

    ['headers' => $headers] = registerUser();
    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $headers)->json('data.id');
    $file = UploadedFile::fake()->createWithContent('sample.pdf', minimalPdfBytes());
    $documentId = apiPost("/api/v1/projects/{$projectId}/documents", ['file' => $file], $headers)->json('data.id');

    apiDelete("/api/v1/documents/{$documentId}", [], $headers)->assertOk();

    apiGet("/api/v1/documents/{$documentId}", $headers)->assertStatus(404);
});

// BE-020
test('retrying a failed processing job does not duplicate page records', function () {
    ['headers' => $headers] = registerUser();
    $projectId = apiPost('/api/v1/projects', ['name' => 'P'], $headers)->json('data.id');
    $file = UploadedFile::fake()->createWithContent('sample.pdf', minimalPdfBytes());

    $documentId = apiPost("/api/v1/projects/{$projectId}/documents", ['file' => $file], $headers)->json('data.id');
    $document = App\Models\Document::findOrFail($documentId);

    // Process the same document twice (simulating a queue retry after a transient failure).
    (new App\Jobs\ProcessDocumentJob($document->id))->handle();
    (new App\Jobs\ProcessDocumentJob($document->id))->handle();

    expect($document->fresh()->pages()->count())->toBe(1);
    expect($document->fresh()->status)->toBe('ready');
});
