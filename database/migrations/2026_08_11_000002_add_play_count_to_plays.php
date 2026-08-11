<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Lifetime play count per distinct song (one row per song). recordPlay
        // carries this over on its delete-insert so listening stats can rank by
        // it, while recency ordering still uses played_at/id.
        Schema::table('plays', function (Blueprint $table) {
            $table->unsignedInteger('play_count')->default(1)->after('spotify_id');
        });
    }

    public function down(): void
    {
        Schema::table('plays', function (Blueprint $table) {
            $table->dropColumn('play_count');
        });
    }
};
