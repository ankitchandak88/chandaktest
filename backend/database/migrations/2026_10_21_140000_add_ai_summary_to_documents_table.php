<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('documents', function (Blueprint $table) {
            // Cached so re-opening a document doesn't re-call the (possibly
            // paid, rate-limited) AI provider every time - see
            // AiAssistantService::summarizeDocument().
            $table->longText('ai_summary')->nullable()->after('citation_metadata');
        });
    }

    public function down(): void
    {
        Schema::table('documents', function (Blueprint $table) {
            $table->dropColumn('ai_summary');
        });
    }
};
