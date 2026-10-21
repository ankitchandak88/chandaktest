<?php

namespace App\Services;

use App\Models\Project;
use PhpOffice\PhpWord\IOFactory;
use PhpOffice\PhpWord\PhpWord;

/**
 * Phase 13 (DOCX export): same content scope as the default compiled 'pdf'
 * export (GenerateExportJob + exports.compiled view) - project name,
 * excerpts annotated with their source document and page, then a Notes
 * section - but built directly against PHPWord's section/text API rather
 * than reusing the Blade/mPDF HTML pipeline, since PHPWord's HTML importer
 * doesn't understand mPDF-specific tags like <pagebreak /> and docx is a
 * different enough target (Word's own paragraph/run model, not a rendered
 * page) that a shared template would fight both renderers. No 'pdf_highlights'
 * equivalent: that format stamps excerpt regions onto the original PDF's
 * pages, a concept that doesn't carry over to a text document.
 */
class DocxExportGenerator
{
    public function generate(Project $project, string $outputPath): void
    {
        $project->loadMissing('excerpts.document', 'notes');

        $phpWord = new PhpWord;
        $section = $phpWord->addSection();

        $section->addText($project->name, ['bold' => true, 'size' => 20]);
        $section->addTextBreak();

        foreach ($project->excerpts as $excerpt) {
            $source = $excerpt->document->original_filename ?? 'Unknown source';
            $section->addText("Source: {$source}, page {$excerpt->page_number}", ['italic' => true, 'size' => 9]);
            $section->addText($excerpt->text);
            $section->addTextBreak();
        }

        if ($project->notes->isNotEmpty()) {
            $section->addPageBreak();
            $section->addText('Notes', ['bold' => true, 'size' => 16]);
            $section->addTextBreak();

            foreach ($project->notes as $note) {
                if (filled($note->title)) {
                    $section->addText($note->title, ['bold' => true, 'size' => 12]);
                }
                $section->addText($note->content);
                $section->addTextBreak();
            }
        }

        IOFactory::createWriter($phpWord, 'Word2007')->save($outputPath);
    }
}
