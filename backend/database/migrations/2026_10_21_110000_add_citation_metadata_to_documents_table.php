<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('documents', function (Blueprint $table) {
            // {author, title, year, publisher, url} - all optional. Kept as
            // one JSON column rather than five nullable columns since this
            // is purely display/formatting data, never queried on.
            $table->json('citation_metadata')->nullable()->after('thumbnail_storage_key');
        });
    }

    public function down(): void
    {
        Schema::table('documents', function (Blueprint $table) {
            $table->dropColumn('citation_metadata');
        });
    }
};
