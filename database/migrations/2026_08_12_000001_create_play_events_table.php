<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Append-only log — one row per play — so listening stats can be
        // scoped to a real time window (week/month/year). The `plays` table
        // keeps its one-row-per-song shape for the recently-played shelf;
        // this is a separate, prunable event stream.
        Schema::create('play_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('dedupe_key', 191); // song identity, for grouping
            $table->string('title', 300);
            $table->string('artist', 300)->default('');
            $table->text('cover')->nullable();
            $table->timestamp('played_at');
            $table->index(['user_id', 'played_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('play_events');
    }
};
