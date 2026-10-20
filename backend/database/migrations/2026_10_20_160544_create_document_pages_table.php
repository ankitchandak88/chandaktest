<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('document_pages', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('document_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('page_number');
            $table->longText('text')->nullable();
            $table->timestamps();
            $table->unique(['document_id', 'page_number']);
        });

        // MySQL fulltext index for search (added separately so it works across MySQL versions).
        DB::statement('ALTER TABLE document_pages ADD FULLTEXT document_pages_text_fulltext (text)');
    }

    public function down(): void
    {
        Schema::dropIfExists('document_pages');
    }
};
