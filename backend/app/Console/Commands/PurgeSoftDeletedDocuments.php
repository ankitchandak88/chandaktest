<?php

namespace App\Console\Commands;

use App\Models\Document;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * BUG-003: the second half of the document deletion lifecycle. A document
 * soft-deleted via DocumentController::destroy() is already invisible to
 * every normal API response; this command is what makes the deletion
 * permanent once the retention window (config('documents.retention_days'))
 * has passed - removing the physical file, document_pages, and
 * force-deleting the excerpts/annotations/document rows themselves.
 *
 * Safe to run repeatedly: `onlyTrashed()->where('deleted_at', '<=', ...)`
 * naturally stops matching once a document has been purged.
 */
class PurgeSoftDeletedDocuments extends Command
{
    protected $signature = 'app:purge-soft-deleted-documents {--dry-run : List what would be purged without deleting anything}';

    protected $description = 'Permanently remove documents (and their files/excerpts/annotations) soft-deleted past the retention window';

    public function handle(): int
    {
        $cutoff = now()->subDays((int) config('documents.retention_days', 30));

        $documents = Document::onlyTrashed()
            ->where('deleted_at', '<=', $cutoff)
            ->get();

        if ($documents->isEmpty()) {
            $this->info('Nothing to purge.');

            return self::SUCCESS;
        }

        foreach ($documents as $document) {
            $this->line("Purging document {$document->id} ({$document->original_filename}), deleted {$document->deleted_at}");

            if ($this->option('dry-run')) {
                continue;
            }

            Storage::disk('local')->delete($document->storage_key);
            $document->pages()->delete();

            // forceDelete() bypasses the normal soft-delete, but these rows
            // are already soft-deleted (cascaded from the document's own
            // delete) - this is the permanent-removal step, not a bypass of
            // the BUG-003 fix.
            $document->excerpts()->onlyTrashed()->get()->each->forceDelete();
            $document->annotations()->onlyTrashed()->get()->each->forceDelete();

            $document->forceDelete();
        }

        $this->info(($this->option('dry-run') ? 'Would purge ' : 'Purged ').$documents->count().' document(s).');

        return self::SUCCESS;
    }
}
