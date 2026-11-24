<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('phrase_definitions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('project_id')->constrained('projects')->cascadeOnDelete();
            $table->foreignUuid('document_id')->nullable()->constrained('documents')->cascadeOnDelete();
            $table->string('term', 150)->index();
            $table->text('definition');
            $table->unsignedInteger('page_number')->nullable();
            $table->json('source_rects')->nullable();
            $table->timestamps();

            $table->index(['project_id', 'term']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('phrase_definitions');
    }
};
