<?php

namespace App\Support;

/**
 * Which build of the app this server runs. The player page carries it
 * (<meta name="app-build">) and compares it with GET /version to notice a
 * deploy (script.js, "New versions"); the You page and Settings show it as
 * a date.
 *
 * It is the newest modification time of the files the page is made of. A
 * deploy checks every file out afresh, so on Laravel Cloud they all carry
 * the deploy's time: every server of one deploy answers the same number,
 * a later deploy a bigger one. Locally it moves whenever one is saved. The
 * page asks for these files with ?v=<their time> (player.blade.php), so a
 * newer build is exactly a page that would load new files.
 */
class AppBuild
{
    /** Under public/: what player.blade.php loads with ?v= (AppVersionTest keeps the two in step). */
    public const ASSETS = ['css/styles.css', 'vendor/gif.js/gif.js', 'js/player-debug.js', 'js/script.js', 'js/cloud-music.js'];

    /** The build's number: a Unix time. */
    public static function id(): int
    {
        $times = array_map(fn (string $file): int => (int) filemtime(public_path($file)), self::ASSETS);
        $times[] = (int) filemtime(resource_path('views/music/player.blade.php'));

        return max($times);
    }

    /** For people (the You page, Settings): "2026-10-15 17:59 UTC". */
    public static function label(): string
    {
        return gmdate('Y-m-d H:i', self::id()).' UTC';
    }
}
