<?php

use App\Models\Excerpt;
use App\Models\Note;
use App\Models\Project;
use App\Services\DocxExportGenerator;

// Phase 13: verifies the actual docx XML a real Word (or any OOXML-
// compliant reader) would load, not just "a file got written" - a docx is
// a zip archive, so the generator could silently produce a corrupt or
// empty one and still "succeed" from PHPWord's point of view.
function extractDocxBodyText(string $path): string
{
    $zip = new ZipArchive;
    $zip->open($path);
    $xml = $zip->getFromName('word/document.xml');
    $zip->close();

    return $xml;
}

test('generates a docx with project name, excerpt source/page, and notes', function () {
    ['user' => $user, 'organization' => $organization] = registerUser();
    $project = Project::create([
        'organization_id' => $organization->id,
        'name' => 'Research on Something',
        'created_by' => $user->id,
    ]);

    $document = createReadyDocument($project, $user->id);
    $document->update(['original_filename' => 'source.pdf']);

    Excerpt::create([
        'organization_id' => $project->organization_id,
        'project_id' => $project->id,
        'document_id' => $document->id,
        'created_by' => $user->id,
        'page_number' => 3,
        'text' => 'A quoted passage worth remembering.',
        'source_rects' => [['x' => 0, 'y' => 0, 'width' => 1, 'height' => 1]],
    ]);

    Note::create([
        'project_id' => $project->id,
        'created_by' => $user->id,
        'title' => 'My note title',
        'content' => 'My note content.',
    ]);

    $outputPath = tempnam(sys_get_temp_dir(), 'docx-export-test');

    app(DocxExportGenerator::class)->generate($project, $outputPath);

    expect(file_exists($outputPath))->toBeTrue();
    expect(substr(file_get_contents($outputPath), 0, 2))->toBe('PK'); // zip signature

    $body = extractDocxBodyText($outputPath);
    expect($body)->toContain('Research on Something');
    expect($body)->toContain('source.pdf');
    expect($body)->toContain('page 3');
    expect($body)->toContain('A quoted passage worth remembering.');
    expect($body)->toContain('My note title');
    expect($body)->toContain('My note content.');

    @unlink($outputPath);
});

test('docx export preserves Hindi text exactly - unlike PDF, no font/CMap round-trip concerns', function () {
    ['user' => $user, 'organization' => $organization] = registerUser();
    $project = Project::create([
        'organization_id' => $organization->id,
        'name' => 'Hindi Project',
        'created_by' => $user->id,
    ]);

    $hindiText = 'भारत एक सुंदर देश है। संयुक्ताक्षर भी ठीक से आना चाहिए।';
    Note::create([
        'project_id' => $project->id,
        'created_by' => $user->id,
        'title' => 'Hindi note',
        'content' => $hindiText,
    ]);

    $outputPath = tempnam(sys_get_temp_dir(), 'docx-export-test');
    app(DocxExportGenerator::class)->generate($project, $outputPath);

    $body = extractDocxBodyText($outputPath);
    expect($body)->toContain($hindiText);

    @unlink($outputPath);
});
