<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Annotation/drawing engine, Phase 7: lets "what did I highlight about
     * X" be answered via the same FULLTEXT search already used for
     * document pages/excerpts/notes (SearchController). The searchable
     * text an annotation carries lives in two different places depending
     * on its type - `comment_text` (a plain column) for comments, or
     * `payload->text` (JSON) for highlight/underline (ink has neither,
     * there's nothing to search) - so a stored generated column
     * consolidates both into one place a FULLTEXT index can actually sit
     * on; MySQL can't FULLTEXT-index a JSON column directly, and this
     * server is confirmed MySQL 8.0.30, which supports FULLTEXT on a
     * stored (not virtual) generated column.
     */
    public function up(): void
    {
        Schema::table('annotations', function (Blueprint $table) {
            $table->text('searchable_text')
                ->nullable()
                ->storedAs("COALESCE(comment_text, JSON_UNQUOTE(JSON_EXTRACT(payload, '$.text')))")
                ->after('payload');
        });

        Schema::table('annotations', function (Blueprint $table) {
            $table->fulltext('searchable_text');
        });
    }

    public function down(): void
    {
        Schema::table('annotations', function (Blueprint $table) {
            $table->dropFullText(['searchable_text']);
            $table->dropColumn('searchable_text');
        });
    }
};
