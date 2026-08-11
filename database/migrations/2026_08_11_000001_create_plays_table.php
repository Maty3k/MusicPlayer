<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Per-user "recently played" song history. Denormalized on purpose:
        // song rows are volatile (they cascade-delete with a playlist and get
        // reindexed/moved), so a song_id FK would lose history. One row per
        // distinct song per user (unique dedupe_key), played_at bumped on each
        // replay — "recent" is just order-by-played_at.
        Schema::create('plays', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // youtube id, or sp:/mp3:/tt: prefixed identity for songs without one.
            $table->string('dedupe_key', 191);
            $table->string('title', 300);
            $table->string('artist', 300)->default('');
            $table->string('album', 300)->default('');
            $table->text('cover')->nullable();
            $table->string('youtube_id', 20)->nullable();
            $table->text('mp3_url')->nullable();
            $table->string('spotify_id', 40)->nullable();
            $table->timestamp('played_at');
            $table->timestamps();
            $table->unique(['user_id', 'dedupe_key']);
            $table->index(['user_id', 'played_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('plays');
    }
};
