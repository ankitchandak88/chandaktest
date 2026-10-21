<?php

namespace App\Services;

use Mpdf\Mpdf;
use Mpdf\Output\Destination;

/**
 * BE-009: GenerateExportJob (and PdfHighlightOverlayGenerator's notes
 * appendix) used to build PDFs with plain FPDF, whose core fonts are
 * Latin-1 only - any non-Latin script (Hindi/Devanagari, Chinese, Arabic,
 * Cyrillic, ...) got mangled by a lossy iconv transliteration instead of
 * rendering. mPDF with autoScriptToLang/autoLangToFont enabled detects the
 * actual Unicode script of each run of text and switches to a bundled font
 * that can render it (and, for complex scripts like Devanagari, shapes
 * conjuncts/reordering correctly - something naively embedding a single
 * TTF into FPDF would not do), so this covers far more than just Hindi
 * without needing to hardcode which languages to support.
 */
class HtmlToPdfRenderer
{
    public function render(string $html, string $outputPath): void
    {
        $mpdf = new Mpdf([
            'mode' => 'UTF-8',
            'autoScriptToLang' => true,
            'autoLangToFont' => true,
            'tempDir' => sys_get_temp_dir(),
        ]);

        $mpdf->WriteHTML($html);
        $mpdf->Output($outputPath, Destination::FILE);
    }
}
