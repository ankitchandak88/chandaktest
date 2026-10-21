<?php

namespace App\Services;

use App\Models\Project;
use Illuminate\Support\Facades\Storage;
use setasign\Fpdi\Fpdi;

/**
 * EXPORT-001: stamps each excerpt's source_rects onto the actual page of
 * the original PDF it came from, rather than the plain compiled-text
 * export GenerateExportJob produces by default. Only documents that are
 * `ready` and still have their file on disk are included; anything else is
 * silently skipped (a document mid-processing or already purged shouldn't
 * fail the whole export).
 *
 * Simplification: plain FPDF/FPDI has no built-in alpha/transparency
 * support (that needs manually injecting ExtGState PDF resources, a known
 * but fragile recipe), so excerpts are marked with a colored OUTLINE
 * rectangle rather than a translucent fill - visible without ever
 * obscuring the underlying text. A true translucent highlight is a
 * reasonable follow-up, not in this pass's scope.
 */
class PdfHighlightOverlayGenerator
{
    private const HIGHLIGHT_COLOR = [250, 204, 21]; // amber-400, matches the web canvas's excerpt chip color
    private const HIGHLIGHT_LINE_WIDTH_MM = 0.6;

    public function __construct(private readonly HtmlToPdfRenderer $htmlToPdf)
    {
    }

    public function generate(Project $project, string $outputPath): void
    {
        $pdf = new Fpdi;
        $project->loadMissing('documents', 'excerpts', 'notes');
        $anyPages = false;

        foreach ($project->documents as $document) {
            if ($document->status !== 'ready' || ! Storage::disk('local')->exists($document->storage_key)) {
                continue;
            }

            $this->appendDocumentPages($pdf, $document, $project);
            $anyPages = true;
        }

        if ($project->notes->isNotEmpty()) {
            $this->appendNotesSummary($pdf, $project);
            $anyPages = true;
        }

        if (! $anyPages) {
            // FPDF errors on Output() with zero pages - a project with no
            // ready documents and no notes yet is a real (if unusual) state,
            // not something that should fail the export job.
            $pdf->AddPage();
            $pdf->SetFont('Arial', '', 12);
            $pdf->MultiCell(0, 6, 'This project has no ready documents or notes to export yet.');
        }

        $pdf->Output('F', $outputPath);
    }

    private function appendDocumentPages(Fpdi $pdf, $document, Project $project): void
    {
        $localPath = Storage::disk('local')->path($document->storage_key);
        $pageCount = $pdf->setSourceFile($localPath);

        $excerptsByPage = $project->excerpts
            ->where('document_id', $document->id)
            ->groupBy('page_number');

        for ($pageNumber = 1; $pageNumber <= $pageCount; $pageNumber++) {
            $templateId = $pdf->importPage($pageNumber);
            $size = $pdf->getTemplateSize($templateId);

            $pdf->AddPage($size['orientation'], [$size['width'], $size['height']]);
            $pdf->useTemplate($templateId);

            foreach ($excerptsByPage->get($pageNumber, []) as $excerpt) {
                $this->drawHighlights($pdf, $excerpt->source_rects, $size['width'], $size['height']);
            }
        }
    }

    private function drawHighlights(Fpdi $pdf, array $rects, float $pageWidth, float $pageHeight): void
    {
        [$r, $g, $b] = self::HIGHLIGHT_COLOR;
        $pdf->SetDrawColor($r, $g, $b);
        $pdf->SetLineWidth(self::HIGHLIGHT_LINE_WIDTH_MM);

        foreach ($rects as $rect) {
            // source_rects are normalized 0-1, top-left origin - the same
            // convention web/src/components/PdfViewer.tsx captures them in,
            // and FPDF's coordinate space is also top-left origin, so no
            // axis flip is needed.
            $pdf->Rect(
                ($rect['x'] ?? 0) * $pageWidth,
                ($rect['y'] ?? 0) * $pageHeight,
                ($rect['width'] ?? 0) * $pageWidth,
                ($rect['height'] ?? 0) * $pageHeight,
                'D'
            );
        }
    }

    /**
     * Rendered as its own standalone mPDF document (BE-009: Unicode script
     * auto-detection, see HtmlToPdfRenderer) and imported into the main
     * FPDI canvas page-by-page, the same technique appendDocumentPages()
     * uses for each source document - FPDI can import pages from any valid
     * PDF, including one mPDF just generated, so this keeps notes'
     * non-Latin text rendering correctly without mixing two incompatible
     * low-level drawing APIs on the same page.
     */
    private function appendNotesSummary(Fpdi $pdf, Project $project): void
    {
        $html = view('exports.notes-summary', ['notes' => $project->notes])->render();
        $tmpPath = tempnam(sys_get_temp_dir(), 'notes-summary');

        try {
            $this->htmlToPdf->render($html, $tmpPath);

            $pageCount = $pdf->setSourceFile($tmpPath);

            for ($pageNumber = 1; $pageNumber <= $pageCount; $pageNumber++) {
                $templateId = $pdf->importPage($pageNumber);
                $size = $pdf->getTemplateSize($templateId);

                $pdf->AddPage($size['orientation'], [$size['width'], $size['height']]);
                $pdf->useTemplate($templateId);
            }
        } finally {
            @unlink($tmpPath);
        }
    }
}
