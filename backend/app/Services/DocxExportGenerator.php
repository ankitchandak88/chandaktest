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
        $project->loadMissing(['excerpts.document', 'notes', 'workspaces.items', 'phraseDefinitions']);

        $phpWord = new PhpWord;
        $section = $phpWord->addSection([
            'marginTop' => 1100,
            'marginBottom' => 1100,
            'marginLeft' => 1200,
            'marginRight' => 1200,
        ]);

        // Legal Header
        $section->addText($project->name, ['bold' => true, 'size' => 22, 'color' => '1e293b']);
        $section->addText('Legal Research Synthesis & Case Brief', ['italic' => true, 'size' => 11, 'color' => '64748b']);
        $section->addText('Generated on ' . date('F j, Y, g:i a') . ' via ChandakText', ['size' => 9, 'color' => '94a3b8']);
        $section->addTextBreak();

        // 1. Workspaces / Boards Summary
        $workspaces = $project->workspaces;
        if ($workspaces->isNotEmpty()) {
            $section->addText('Workspace Boards', ['bold' => true, 'size' => 14, 'color' => '0f172a']);
            foreach ($workspaces as $ws) {
                $section->addText("• {$ws->name} (" . ($ws->items->count()) . " items)", ['size' => 10, 'color' => '334155']);
            }
            $section->addTextBreak();
        }

        // 2. Excerpts & Evidentiary Citations
        $section->addText('Evidentiary Citations & Excerpts', ['bold' => true, 'size' => 16, 'color' => '0f172a']);
        $section->addTextBreak();

        foreach ($project->excerpts as $idx => $excerpt) {
            $source = $excerpt->document->original_filename ?? 'Pleading / Exhibit';
            $citationHeader = "Citation [" . ($idx + 1) . "] — Source: {$source}, Page {$excerpt->page_number}";
            
            $section->addText($citationHeader, ['bold' => true, 'italic' => true, 'size' => 9, 'color' => '475569']);
            
            // Blockquote styling
            $section->addText('“' . trim($excerpt->text) . '”', [
                'italic' => true,
                'size' => 10.5,
                'color' => '0f172a',
            ], [
                'spaceAfter' => 120,
                'indentation' => ['left' => 360, 'right' => 200],
            ]);
            $section->addTextBreak(1);
        }

        // 3. Notes & Submissions
        if ($project->notes->isNotEmpty()) {
            $section->addPageBreak();
            $section->addText('Argument Notes & Submissions', ['bold' => true, 'size' => 16, 'color' => '0f172a']);
            $section->addTextBreak();

            foreach ($project->notes as $note) {
                if (filled($note->title)) {
                    $section->addText($note->title, ['bold' => true, 'size' => 12, 'color' => '1e293b']);
                }
                $section->addText($note->content, ['size' => 10.5, 'color' => '334155']);
                $section->addTextBreak();
            }
        }

        // 4. Defined Terms Glossary (Lesson 17 & Corporate Law Demo)
        $terms = $project->phraseDefinitions;
        if ($terms->isNotEmpty()) {
            $section->addPageBreak();
            $section->addText('Defined Terms & Contract Glossary', ['bold' => true, 'size' => 16, 'color' => '0f172a']);
            $section->addText('Extracted from contracts, covenants, and case definitions.', ['italic' => true, 'size' => 10, 'color' => '64748b']);
            $section->addTextBreak();

            foreach ($terms as $t) {
                $pageInfo = $t->page_number ? " (Page {$t->page_number})" : '';
                $section->addText("“{$t->term}”{$pageInfo}", ['bold' => true, 'size' => 11, 'color' => 'b45309']);
                $section->addText($t->definition, ['size' => 10, 'color' => '334155']);
                $section->addTextBreak(1);
            }
        }

        IOFactory::createWriter($phpWord, 'Word2007')->save($outputPath);
    }
}
