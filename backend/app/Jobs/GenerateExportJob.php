<?php

namespace App\Jobs;

use App\Models\Export;
use App\Services\HtmlToPdfRenderer;
use App\Services\PdfHighlightOverlayGenerator;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/**
 * MVP export scope (docs/01 section 1.4 + docs/10 Phase 5): the default
 * 'pdf' format compiles the project's notes and excerpts — each excerpt
 * annotated with its source document and page — into a single research-
 * output PDF, rendered via HtmlToPdfRenderer (BE-009: mPDF with Unicode
 * script auto-detection, not plain FPDF's Latin-1-only core fonts) so
 * non-Latin text (Hindi, Arabic, Chinese, ...) renders correctly instead
 * of being transliterated into something unreadable. For 'pdf_highlights'
 * (EXPORT-001), see PdfHighlightOverlayGenerator - that one stamps excerpt
 * regions directly onto the original PDF's pages instead. DOCX export is
 * not implemented yet — the PRD explicitly defers it until a library/
 * formatting scope is chosen, so requesting format=docx fails clearly
 * instead of producing something.
 */
class GenerateExportJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 2;

    public int $timeout = 180;

    public function __construct(public string $exportId)
    {
    }

    public function handle(): void
    {
        $export = Export::with('project.notes', 'project.excerpts.document')->find($this->exportId);

        if (! $export) {
            return;
        }

        if (! in_array($export->format, ['pdf', 'pdf_highlights'], true)) {
            $export->forceFill([
                'status' => 'failed',
                'failure_reason' => 'DOCX export is not implemented in this MVP yet.',
            ])->save();

            return;
        }

        try {
            $export->update(['status' => 'processing']);

            $project = $export->project;
            $key = "exports/{$export->id}.pdf";
            $tmpPath = tempnam(sys_get_temp_dir(), 'export');

            if ($export->format === 'pdf_highlights') {
                app(PdfHighlightOverlayGenerator::class)->generate($project, $tmpPath);
            } else {
                $html = view('exports.compiled', ['project' => $project])->render();
                app(HtmlToPdfRenderer::class)->render($html, $tmpPath);
            }

            Storage::disk('local')->put($key, file_get_contents($tmpPath));
            @unlink($tmpPath);

            $export->forceFill([
                'status' => 'ready',
                'storage_key' => $key,
                'expires_at' => now()->addMinutes((int) config('exports.link_ttl_minutes', 30)),
            ])->save();
        } catch (\Throwable $e) {
            Log::error('Export generation failed', ['export_id' => $export->id, 'error' => $e->getMessage()]);

            $export->forceFill([
                'status' => 'failed',
                'failure_reason' => 'Export generation failed.',
            ])->save();
        }
    }
}
