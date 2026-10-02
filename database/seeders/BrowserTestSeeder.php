<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;

/**
 * The five accounts the phone browser suites (tests/browser) log in as:
 *
 *   demo@example.com   one empty Favorites playlist (what user:create makes)
 *   few@example.com    4 playlists, 8 recent plays
 *   mid@example.com    7 playlists incl. empty "Sunday Morning" and "Focus Mode",
 *                      10 recent plays and a play log
 *   many@example.com   14 playlists (two empty), 12 recent plays
 *   empty@example.com  no playlists at all (the first-run wizard account)
 *
 * All verified, password BROWSER_TEST_PASSWORD (default demo-pass-123). The
 * data mirrors the local test database the suites were written against: the
 * playlists and songs come from the session's seed.php, the extras (mid's
 * plays, recently-opened lists, saved song positions) from that database.
 * YouTube ids are real-looking but the suites never load YouTube.
 *
 * Re-runnable: an existing account keeps its id and password hash (so saved
 * browser logins stay valid) and has its library and plays rebuilt.
 *
 *   php artisan db:seed --class=BrowserTestSeeder
 */
class BrowserTestSeeder extends Seeder
{
    private const IDS = ['dQw4w9WgXcQ', 'kJQP7kiw5Fk', '9bZkp7q19f0', 'JGwWNGJdvx8', 'fJ9rUzIMcZQ', 'hTWKbfoikeg',
        'RgKAFK5djSk', 'OPf0YbXqDm0', 'CevxZvSJLk8', 'YQHsXMglC9A', '60ItHLz5WEA', 'kXYiU_JCYtU',
        'hT_nvWreIhg', 'lp-EO5I60KA', 'pRpeEdMmmQ0', 'uelHwf8o7_U'];

    private const NAMES = ['Favorites', 'Late Night Drive', 'Sunday Morning', 'Gym Rotation', 'Road Trip 2026',
        'Chill Vinyl', 'Focus Mode', 'Throwbacks', 'Summer Hits', 'Rainy Day Jazz', 'Party Starters',
        'Acoustic Covers', 'Indie Finds', 'Workout Mix', 'Sleep Sounds', 'Classics'];

    private const COLORS = ['#d4a574', '#7eb8da', '#c77dff', '#80ed99', '#ff8fa3', '#ffd166', '#90e0ef', '#f4a261'];

    public function run(): void
    {
        $password = (string) env('BROWSER_TEST_PASSWORD', 'demo-pass-123');
        $now = Carbon::now();

        // demo: the CreateUser bootstrap — an empty Favorites, active.
        $demo = $this->account('demo@example.com', 'Demo', $password);
        $demo->playlists()->create(['slug' => 'favorites', 'name' => 'Favorites', 'position' => 0]);
        $demo->update(['active_playlist_slug' => 'favorites', 'recently_played' => ['favorites']]);

        // few / many / mid: seed.php's library generator.
        $few = $this->account('few@example.com', 'Few', $password);
        $this->library($few, 4, [12, 7, 23, 3]);
        $few->update(['active_playlist_slug' => 'favorites', 'recently_played' => ['favorites']]);
        $this->recentPlays($few, 8, $now);

        $many = $this->account('many@example.com', 'Many', $password);
        $this->library($many, 14, [18, 9, 31, 4, 0, 12], ['favorites' => 11, 'pl-1' => 3]);
        $many->update(['active_playlist_slug' => 'favorites', 'recently_played' => ['favorites', 'pl-1']]);
        $this->recentPlays($many, 12, $now);

        // mid: Favorites 10, Late Night Drive 5, Sunday Morning 0, Gym Rotation 22,
        // Road Trip 2026 10, Chill Vinyl 5, Focus Mode 0.
        $mid = $this->account('mid@example.com', 'Mid', $password);
        $this->library($mid, 7, [10, 5, 0, 22]);
        $mid->update(['active_playlist_slug' => 'favorites', 'recently_played' => ['favorites', 'pl-5', 'pl-2', 'pl-3']]);
        $this->midPlays($mid, $now);

        // empty: no playlists, nothing active (straight from registration).
        $empty = $this->account('empty@example.com', 'Empty', $password);
        $empty->update(['active_playlist_slug' => null, 'recently_played' => null]);
    }

    /** Find or create a verified account and clear its library and plays. */
    private function account(string $email, string $name, string $password): User
    {
        $user = User::where('email', $email)->first();
        if ($user === null) {
            $user = User::forceCreate([
                'email' => $email,
                'name' => $name,
                'password' => $password,
                'email_verified_at' => now(),
            ]);
        } else {
            $user->forceFill(['name' => $name, 'email_verified_at' => $user->email_verified_at ?? now()])->save();
        }

        foreach ($user->playlists()->get() as $playlist) {
            $playlist->songs()->delete();
            $playlist->delete();
        }
        $user->plays()->delete();
        $user->playEvents()->delete();
        $user->spotifyToken()->delete();

        return $user;
    }

    /**
     * seed.php's makeUser(): playlist 0 is Favorites, the rest pl-1..pl-N with
     * names/colors from the lists above; song counts cycle through $songsPer.
     *
     * @param  array<int, int>  $songsPer
     * @param  array<string, int>  $currentIndex  saved song position per slug
     */
    private function library(User $user, int $count, array $songsPer, array $currentIndex = []): void
    {
        for ($p = 0; $p < $count; $p++) {
            $slug = $p === 0 ? 'favorites' : 'pl-'.$p;
            $name = self::NAMES[$p % count(self::NAMES)];
            $playlist = $user->playlists()->create([
                'slug' => $slug,
                'name' => $name,
                'position' => $p,
                'color' => self::COLORS[$p % count(self::COLORS)],
                'current_index' => $currentIndex[$slug] ?? 0,
            ]);
            $n = $songsPer[$p % count($songsPer)];
            for ($s = 0; $s < $n; $s++) {
                $vid = self::IDS[($p * 3 + $s) % count(self::IDS)];
                $playlist->songs()->create([
                    'position' => $s,
                    'title' => 'Song '.($s + 1).' of '.$name,
                    'artist' => 'Artist '.chr(65 + ($s % 26)),
                    'album' => '',
                    'youtube_id' => $vid,
                    'cover' => "https://i.ytimg.com/vi/$vid/hqdefault.jpg",
                ]);
            }
        }
    }

    /** seed.php's "Jump back in" plays: Recent song 1..n, 7 minutes apart. */
    private function recentPlays(User $user, int $n, Carbon $now): void
    {
        for ($i = 0; $i < $n; $i++) {
            $vid = self::IDS[$i % count(self::IDS)];
            $user->plays()->create([
                'dedupe_key' => 'yt:'.$vid,
                'title' => 'Recent song '.($i + 1),
                'artist' => 'Artist '.chr(65 + $i),
                'cover' => "https://i.ytimg.com/vi/$vid/hqdefault.jpg",
                'youtube_id' => $vid,
                'played_at' => $now->copy()->subMinutes($i * 7),
            ]);
        }
    }

    /**
     * mid's plays as the local test database had them (the suites played them
     * through the app): the recently-played shelf, newest first, with play
     * counts, and the play log behind its stats. Times are relative to now.
     */
    private function midPlays(User $user, Carbon $now): void
    {
        // [favorites song number (1-based), seconds ago, play_count], newest
        // first as the shelf shows them; "Findable" by Band was a song a suite
        // added through search. Inserted oldest first so ids rise with recency
        // (recentSongs() breaks played_at ties by id, like recordPlay's
        // delete-and-insert does).
        $shelf = [[7, 0, 2], [1, 2, 4], [6, 22, 5], [4, 6920, 3], [2, 6943, 3], [3, 95960, 5],
            ['Findable', 186176, 1], [9, 186184, 1], [8, 186184, 1], [5, 186185, 2]];
        foreach (array_reverse($shelf) as [$song, $ago, $count]) {
            $play = $this->midSong($song) + ['played_at' => $now->copy()->subSeconds($ago), 'play_count' => $count];
            $user->plays()->create($play);
        }

        // Play log, oldest first (27 plays over three days), [song, seconds ago].
        $log = [[5, 186268], [3, 186266], [6, 186245], [1, 186244], [2, 186188], [3, 186187], [5, 186185], [6, 186185],
            [7, 186184], [8, 186184], [9, 186184], ['Findable', 186176], [2, 186053], [3, 167916], [6, 167914], [4, 167894],
            [3, 167892], [4, 97964], [3, 95960], [2, 6943], [1, 6941], [4, 6920], [6, 6918], [1, 24], [6, 22], [1, 2], [7, 0]];
        foreach ($log as [$song, $ago]) {
            $s = $this->midSong($song);
            $user->playEvents()->create([
                'dedupe_key' => $s['dedupe_key'],
                'title' => $s['title'],
                'artist' => $s['artist'],
                'cover' => $s['cover'],
                'played_at' => $now->copy()->subSeconds($ago),
            ]);
        }
    }

    /** @return array<string, string> a song of mid's Favorites (or the searched-for "Findable") in plays shape */
    private function midSong(int|string $song): array
    {
        if ($song === 'Findable') {
            return ['dedupe_key' => 'yt:FOUNDvid123', 'title' => 'Findable', 'artist' => 'Band', 'album' => '',
                'cover' => '', 'youtube_id' => 'FOUNDvid123', 'mp3_url' => '', 'spotify_id' => ''];
        }
        $s = $song - 1;
        $vid = self::IDS[$s % count(self::IDS)];

        return ['dedupe_key' => 'yt:'.$vid, 'title' => 'Song '.$song.' of Favorites', 'artist' => 'Artist '.chr(65 + $s),
            'album' => '', 'cover' => "https://i.ytimg.com/vi/$vid/hqdefault.jpg", 'youtube_id' => $vid, 'mp3_url' => '', 'spotify_id' => ''];
    }
}
