<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // EXPORT-001: the original PDF's pages with excerpt regions outlined
        // in place, instead of (or alongside) the compiled notes/excerpts
        // summary document. Plain ALTER rather than a Blueprint enum() call
        // so existing rows and the 'pdf'/'docx' values are left alone.
        DB::statement("ALTER TABLE exports MODIFY format ENUM('pdf', 'pdf_highlights', 'docx') NOT NULL DEFAULT 'pdf'");
    }

    public function down(): void
    {
        DB::statement("ALTER TABLE exports MODIFY format ENUM('pdf', 'docx') NOT NULL DEFAULT 'pdf'");
    }
};
