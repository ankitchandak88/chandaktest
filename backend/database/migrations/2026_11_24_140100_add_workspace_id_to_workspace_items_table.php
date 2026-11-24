<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('workspace_items', 'workspace_id')) {
            Schema::table('workspace_items', function (Blueprint $table) {
                $table->foreignUuid('workspace_id')->nullable()->after('project_id')->constrained('workspaces')->cascadeOnDelete();
            });
        }

        // Backfill workspace_id for existing workspace_items using each project's default workspace
        $workspaces = DB::table('workspaces')->select('id', 'project_id')->get()->groupBy('project_id');
        foreach ($workspaces as $projectId => $projectWorkspaces) {
            $defaultWorkspaceId = $projectWorkspaces->first()->id;
            DB::table('workspace_items')
                ->where('project_id', $projectId)
                ->whereNull('workspace_id')
                ->update(['workspace_id' => $defaultWorkspaceId]);
        }

        // First ensure project_id has a dedicated index so foreign key constraint is satisfied when dropping composite unique
        Schema::table('workspace_items', function (Blueprint $table) {
            $table->index('project_id');
        });

        // Drop old unique constraint and add new one scoped to workspace_id
        Schema::table('workspace_items', function (Blueprint $table) {
            $table->dropUnique('workspace_items_project_id_item_type_target_id_unique');
            $table->unique(['project_id', 'workspace_id', 'item_type', 'target_id'], 'ws_items_proj_ws_type_target_uniq');
        });
    }

    public function down(): void
    {
        Schema::table('workspace_items', function (Blueprint $table) {
            $table->dropUnique('ws_items_proj_ws_type_target_uniq');
            $table->unique(['project_id', 'item_type', 'target_id']);
            $table->dropForeign(['workspace_id']);
            $table->dropColumn('workspace_id');
        });
    }
};
