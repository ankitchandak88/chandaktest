<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('excerpts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('project_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('document_id')->constrained()->cascadeOnDelete();
            $table->foreignId('created_by')->constrained('users')->cascadeOnDelete();
            $table->unsignedInteger('page_number');
            $table->longText('text');
            $table->json('source_rects');
            $table->timestamps();
            $table->softDeletes();
            $table->index(['project_id', 'document_id']);
            $table->fulltext('text');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('excerpts');
    }
};
