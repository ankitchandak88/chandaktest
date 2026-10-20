<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('annotations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('document_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('project_id')->constrained()->cascadeOnDelete();
            $table->foreignId('created_by')->constrained('users')->cascadeOnDelete();
            $table->unsignedInteger('page_number');
            $table->enum('type', ['highlight', 'underline', 'comment', 'ink']);
            $table->string('color', 16)->nullable();
            $table->text('comment_text')->nullable();
            $table->json('payload');
            $table->timestamps();
            $table->softDeletes();
            $table->index(['document_id', 'page_number']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('annotations');
    }
};
