<?php

namespace App\Jobs;

use App\Models\Document;
use App\Models\DocumentPage;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Smalot\PdfParser\Parser;

/**
 * File processing lifecycle step 5-6 (docs/02 section 2.4): extract page
 * text so search/excerpt-page-count work, then flip status to ready/failed.
 * Runs with a timeout so a malformed/hostile PDF can't wedge a worker
 * forever (docs/02: "parser timeouts... for processing untrusted files").
 */
class ProcessDocumentJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    public int $timeout = 120;

    public function __construct(public string $documentId)
    {
    }

    public function handle(): void
    {
        $document = Document::find($this->documentId);

        if (! $document) {
            return;
        }

        try {
            $absolutePath = Storage::disk('local')->path($document->storage_key);

            $parser = new Parser;
            $pdf = $parser->parseFile($absolutePath);
            $pages = $pdf->getPages();

            foreach ($pages as $index => $page) {
                DocumentPage::updateOrCreate(
                    ['document_id' => $document->id, 'page_number' => $index + 1],
                    ['text' => $page->getText()]
                );
            }

            $document->forceFill([
                'page_count' => count($pages),
                'status' => 'ready',
                'failure_reason' => null,
            ])->save();
        } catch (\Throwable $e) {
            Log::warning('Document processing failed', [
                'document_id' => $document->id,
                'error' => $e->getMessage(),
            ]);

            $document->forceFill([
                'status' => 'failed',
                'failure_reason' => 'The PDF could not be processed. It may be corrupted, encrypted, or password-protected.',
            ])->save();
        }
    }

    public function failed(\Throwable $e): void
    {
        Document::where('id', $this->documentId)->update([
            'status' => 'failed',
            'failure_reason' => 'Processing failed after multiple attempts.',
        ]);
    }
}
