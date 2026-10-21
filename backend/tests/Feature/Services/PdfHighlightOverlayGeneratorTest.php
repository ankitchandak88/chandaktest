<?php

use App\Models\Document;
use App\Models\Excerpt;
use App\Models\Note;
use App\Models\Project;
use App\Services\PdfHighlightOverlayGenerator;
use Illuminate\Support\Facades\Storage;
use setasign\Fpdi\Fpdi;

test('stamps excerpt regions onto the original pdf and appends a notes summary page', function () {
    Storage::fake('local');

    ['user' => $user, 'organization' => $organization] = registerUser();
    $project = Project::create([
        'organization_id' => $organization->id,
        'created_by' => $user->id,
        'name' => 'Overlay test',
    ]);

    $document = createReadyDocument($project, $user->id);
    Storage::disk('local')->put($document->storage_key, minimalPdfBytes());

    Excerpt::create([
        'organization_id' => $project->organization_id,
        'project_id' => $project->id,
        'document_id' => $document->id,
        'created_by' => $user->id,
        'page_number' => 1,
        'text' => 'Highlighted text',
        'source_rects' => [['x' => 0.1, 'y' => 0.1, 'width' => 0.3, 'height' => 0.05]],
    ]);

    Note::create(['project_id' => $project->id, 'created_by' => $user->id, 'title' => 'N', 'content' => 'Note body']);

    $outputPath = tempnam(sys_get_temp_dir(), 'overlay-test');

    app(PdfHighlightOverlayGenerator::class)
        ->generate($project->fresh(['documents', 'excerpts', 'notes']), $outputPath);

    expect(file_exists($outputPath))->toBeTrue();
    $bytes = file_get_contents($outputPath);
    expect(substr($bytes, 0, 5))->toBe('%PDF-');

    // 1 page from the source document (it was a 1-page minimal PDF) + 1
    // appended notes-summary page.
    $reader = new Fpdi;
    expect($reader->setSourceFile($outputPath))->toBe(2);

    @unlink($outputPath);
});

test('a document with no file on disk yet is silently skipped, not a failure', function () {
    Storage::fake('local');

    ['user' => $user, 'organization' => $organization] = registerUser();
    $project = Project::create([
        'organization_id' => $organization->id,
        'created_by' => $user->id,
        'name' => 'No file yet',
    ]);

    Document::factory()->create([
        'organization_id' => $project->organization_id,
        'project_id' => $project->id,
        'uploaded_by' => $user->id,
        'status' => 'processing',
    ]);

    $outputPath = tempnam(sys_get_temp_dir(), 'overlay-test');
    app(PdfHighlightOverlayGenerator::class)
        ->generate($project->fresh(['documents', 'excerpts', 'notes']), $outputPath);

    expect(file_exists($outputPath))->toBeTrue();
    expect(substr(file_get_contents($outputPath), 0, 5))->toBe('%PDF-');

    @unlink($outputPath);
});

test('a project with nothing ready yet still produces a valid single-page pdf', function () {
    ['user' => $user, 'organization' => $organization] = registerUser();
    $project = Project::create([
        'organization_id' => $organization->id,
        'created_by' => $user->id,
        'name' => 'Empty',
    ]);

    $outputPath = tempnam(sys_get_temp_dir(), 'overlay-test');
    app(PdfHighlightOverlayGenerator::class)
        ->generate($project->fresh(['documents', 'excerpts', 'notes']), $outputPath);

    $reader = new Fpdi;
    expect($reader->setSourceFile($outputPath))->toBe(1);

    @unlink($outputPath);
});
