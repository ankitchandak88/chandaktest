<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Same deliberate choice as links/workspace_items (see
        // CleansUpWorkspaceReferences): a typed (taggable_type/taggable_id)
        // pair rather than a real polymorphic FK, so the app controls which
        // model types can be tagged rather than any table being attachable.
        Schema::create('taggables', function (Blueprint $table) {
            $table->foreignUuid('tag_id')->constrained()->cascadeOnDelete();
            $table->enum('taggable_type', ['excerpt', 'note']);
            $table->uuid('taggable_id');
            $table->timestamps();
            $table->primary(['tag_id', 'taggable_type', 'taggable_id']);
            $table->index(['taggable_type', 'taggable_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('taggables');
    }
};
