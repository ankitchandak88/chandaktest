<?php

return [
    /*
     * BUG-003: how long a soft-deleted document's row, physical file,
     * document_pages, excerpts and annotations are kept before
     * App\Console\Commands\PurgeSoftDeletedDocuments permanently removes
     * them. A soft-deleted document is already invisible to normal API
     * responses (Eloquent's SoftDeletes global scope) - this window exists
     * purely so an accidental delete is recoverable for a while.
     */
    'retention_days' => env('DOCUMENT_RETENTION_DAYS', 30),
];
