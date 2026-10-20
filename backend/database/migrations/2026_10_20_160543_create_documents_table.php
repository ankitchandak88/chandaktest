<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('documents', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('project_id')->constrained()->cascadeOnDelete();
            $table->foreignId('uploaded_by')->constrained('users')->cascadeOnDelete();
            $table->string('original_filename');
            $table->string('storage_key');
            $table->string('checksum', 64);
            $table->string('mime_type')->default('application/pdf');
            $table->unsignedBigInteger('size_bytes');
            $table->unsignedInteger('page_count')->nullable();
            $table->enum('status', ['processing', 'ready', 'failed'])->default('processing');
            $table->string('failure_reason')->nullable();
            $table->string('thumbnail_storage_key')->nullable();
            $table->timestamps();
            $table->softDeletes();
            $table->index(['project_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('documents');
    }
};
