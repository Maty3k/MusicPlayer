<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Unguessable public-share token. Null = not shared; set = reachable at
        // /s/{token} read-only. Revoking sharing nulls it (old links 404).
        Schema::table('playlists', function (Blueprint $table) {
            $table->string('share_token', 40)->nullable()->unique()->after('source');
        });
    }

    public function down(): void
    {
        Schema::table('playlists', function (Blueprint $table) {
            $table->dropColumn('share_token');
        });
    }
};
