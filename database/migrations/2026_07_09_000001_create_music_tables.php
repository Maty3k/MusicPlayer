<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('playlists', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // The frontend addresses playlists by a per-user string key
            // ('favorites', 'late-night', ...) — kept as `slug`.
            $table->string('slug', 64);
            $table->string('name', 100);
            $table->string('color', 9)->default('#d4a574');
            $table->unsignedInteger('current_index')->default(0);
            $table->unsignedInteger('cover_song_index')->nullable();
            $table->string('source', 16)->default('user'); // user | spotify
            $table->unsignedInteger('position')->default(0);
            $table->timestamps();
            $table->unique(['user_id', 'slug']);
        });

        Schema::create('songs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('playlist_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('position');
            $table->string('title', 300);
            $table->string('artist', 300)->default('');
            $table->string('album', 300)->default('');
            $table->text('cover')->nullable();
            $table->string('youtube_id', 20)->nullable();
            $table->text('mp3_url')->nullable();
            $table->string('spotify_id', 40)->nullable();
            $table->timestamps();
            $table->index(['playlist_id', 'position']);
        });

        Schema::create('spotify_tokens', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();
            $table->text('access_token');
            $table->text('refresh_token')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();
        });

        // Global spotify_id -> youtube_id resolution cache (replaces
        // data/spotify-youtube-cache.json; safe to share across users).
        Schema::create('youtube_matches', function (Blueprint $table) {
            $table->id();
            $table->string('spotify_id', 40)->unique();
            $table->string('youtube_id', 20);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('youtube_matches');
        Schema::dropIfExists('spotify_tokens');
        Schema::dropIfExists('songs');
        Schema::dropIfExists('playlists');
    }
};
