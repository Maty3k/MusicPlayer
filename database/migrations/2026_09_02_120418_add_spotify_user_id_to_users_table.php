<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // Spotify account id behind "Continue with Spotify": set when a
            // signed-in user connects Spotify, or when the sign-in flow creates
            // the account. Accounts are matched on this only, never on the
            // (unverified) email Spotify reports.
            $table->string('spotify_user_id', 64)->nullable()->unique()->after('member_number');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropUnique(['spotify_user_id']);
            $table->dropColumn('spotify_user_id');
        });
    }
};
