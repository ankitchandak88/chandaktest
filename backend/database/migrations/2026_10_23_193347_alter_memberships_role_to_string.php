<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        DB::statement("ALTER TABLE memberships MODIFY COLUMN role VARCHAR(32) NOT NULL DEFAULT 'member'");
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        DB::statement("ALTER TABLE memberships MODIFY COLUMN role ENUM('owner', 'member') NOT NULL DEFAULT 'member'");
    }
};
