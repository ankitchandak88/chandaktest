<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('workspaces', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('project_id')->constrained()->cascadeOnDelete();
            $table->string('name')->default('Main Board');
            $table->string('color')->nullable();
            $table->integer('order_index')->default(0);
            $table->timestamps();

            $table->index(['project_id', 'order_index']);
        });

        // Automatically backfill a default "Main Board" for every existing project
        $projects = DB::table('projects')->select('id')->get();
        $now = now();
        foreach ($projects as $project) {
            DB::table('workspaces')->insert([
                'id' => (string) Str::uuid(),
                'project_id' => $project->id,
                'name' => 'Main Board',
                'color' => '#2563eb',
                'order_index' => 0,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('workspaces');
    }
};
