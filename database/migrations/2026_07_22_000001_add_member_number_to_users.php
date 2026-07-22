<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // Vinyl-club instant accounts: log in with member number + PIN
            // (the PIN lives in `password`, hashed). Email stays optional
            // until the member attaches one from Settings.
            $table->unsignedInteger('member_number')->nullable()->unique();
            $table->string('email')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('member_number');
            $table->string('email')->nullable(false)->change();
        });
    }
};
