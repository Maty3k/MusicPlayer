<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // Per-user player state that lived at the top level of music.json.
            $table->string('active_playlist_slug', 64)->nullable();
            $table->json('recently_played')->nullable(); // array of playlist slugs
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['active_playlist_slug', 'recently_played']);
        });
    }
};
