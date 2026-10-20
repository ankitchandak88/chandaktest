<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->boolean('is_super_admin')->default(false)->after('password');
            $table->enum('status', ['active', 'suspended'])->default('active')->after('is_super_admin');
            $table->string('suspended_reason')->nullable()->after('status');
            $table->timestamp('suspended_at')->nullable()->after('suspended_reason');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['is_super_admin', 'status', 'suspended_reason', 'suspended_at']);
        });
    }
};
