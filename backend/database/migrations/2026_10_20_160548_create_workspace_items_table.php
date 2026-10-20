<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('workspace_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('project_id')->constrained()->cascadeOnDelete();
            $table->enum('item_type', ['excerpt', 'note']);
            $table->uuid('target_id');
            $table->float('x')->default(0);
            $table->float('y')->default(0);
            $table->float('width')->default(240);
            $table->float('height')->default(160);
            $table->integer('z_index')->default(0);
            $table->timestamps();
            $table->unique(['project_id', 'item_type', 'target_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('workspace_items');
    }
};
