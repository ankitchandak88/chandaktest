<?php

namespace App\Jobs;

use App\Models\Export;
use App\Services\PdfHighlightOverlayGenerator;
use FPDF;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * MVP export scope (docs/01 section 1.4 + docs/10 Phase 5): the default
 * 'pdf' format compiles the project's notes and excerpts — each excerpt
 * annotated with its source document and page — into a single research-
 * output PDF. For 'pdf_highlights' (EXPORT-001), see
 * PdfHighlightOverlayGenerator - that one stamps excerpt regions directly
 * onto the original PDF's pages instead. DOCX export is not implemented
 * yet — the PRD explicitly defers it until a library/formatting scope is
 * chosen, so requesting format=docx fails clearly instead of producing
 * something.
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
                $pdf = new FPDF;
                $pdf->AddPage();
                $pdf->SetFont('Arial', 'B', 16);
                $pdf->MultiCell(0, 10, $this->sanitize($project->name));
                $pdf->SetFont('Arial', '', 10);
                $pdf->MultiCell(0, 6, 'Exported '.now()->toDayDateTimeString());
                $pdf->Ln(4);

                if ($project->excerpts->isNotEmpty()) {
                    $pdf->SetFont('Arial', 'B', 13);
                    $pdf->MultiCell(0, 8, 'Excerpts');
                    $pdf->SetFont('Arial', '', 11);

                    foreach ($project->excerpts as $excerpt) {
                        $source = $excerpt->document->original_filename ?? 'Unknown source';
                        $pdf->SetFont('Arial', 'I', 9);
                        $pdf->MultiCell(0, 5, "Source: {$this->sanitize($source)}, page {$excerpt->page_number}");
                        $pdf->SetFont('Arial', '', 11);
                        $pdf->MultiCell(0, 6, $this->sanitize($excerpt->text));
                        $pdf->Ln(3);
                    }
                }

                if ($project->notes->isNotEmpty()) {
                    $pdf->AddPage();
                    $pdf->SetFont('Arial', 'B', 13);
                    $pdf->MultiCell(0, 8, 'Notes');
                    $pdf->SetFont('Arial', '', 11);

                    foreach ($project->notes as $note) {
                        if ($note->title) {
                            $pdf->SetFont('Arial', 'B', 11);
                            $pdf->MultiCell(0, 6, $this->sanitize($note->title));
                            $pdf->SetFont('Arial', '', 11);
                        }
                        $pdf->MultiCell(0, 6, $this->sanitize((string) $note->content));
                        $pdf->Ln(3);
                    }
                }

                $pdf->Output('F', $tmpPath);
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

    private function sanitize(string $text): string
    {
        // FPDF's core fonts are Latin-1 only; transliterate so UTF-8 source
        // text (smart quotes, accented characters, etc.) doesn't throw.
        return Str::of($text)
            ->pipe(fn ($s) => @iconv('UTF-8', 'ISO-8859-1//TRANSLIT', $s) ?: $s)
            ->toString();
    }
}
