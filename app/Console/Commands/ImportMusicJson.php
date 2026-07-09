<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Imports a legacy music.json (top-level: activePlaylist, recentlyPlayed,
 * playlists map) into a user's account as playlists + songs rows.
 */
class ImportMusicJson extends Command
{
    protected $signature = 'music:import
        {email : Email of the user to import into}
        {path=database/legacy/music.json : Path to the legacy music.json}
        {--force : Delete the user\'s existing playlists first}';

    protected $description = 'Import a legacy music.json file into a user account';

    public function handle(): int
    {
        $email = (string) $this->argument('email');
        $user = User::where('email', $email)->first();
        if ($user === null) {
            $this->error("No user found with email {$email}.");

            return self::FAILURE;
        }

        $path = (string) $this->argument('path');
        $fullPath = is_file($path) ? $path : base_path($path);
        if (! is_file($fullPath)) {
            $this->error("File not found: {$path}");

            return self::FAILURE;
        }

        $data = json_decode((string) file_get_contents($fullPath), true);
        if (! is_array($data) || ! isset($data['playlists']) || ! is_array($data['playlists'])) {
            $this->error("Invalid music.json: {$fullPath} (expected a top-level 'playlists' map).");

            return self::FAILURE;
        }

        // Validate playlist keys up front (same slug rule as the endpoints).
        foreach (array_keys($data['playlists']) as $slug) {
            if (! preg_match('/^[A-Za-z0-9_-]{1,64}$/', (string) $slug)) {
                $this->error("Invalid playlist slug in file: '{$slug}' (must match ^[A-Za-z0-9_-]{1,64}$).");

                return self::FAILURE;
            }
        }

        if (! $this->option('force') && $user->playlists()->whereHas('songs')->exists()) {
            $this->error("{$email} already has playlists with songs. Use --force to replace them.");

            return self::FAILURE;
        }

        [$playlistCount, $songCount] = DB::transaction(function () use ($user, $data): array {
            // Clear existing playlists (with --force, or leftover empty ones)
            // so imported slugs never collide with the unique(user_id, slug).
            $user->playlists()->delete();

            $position = 0;
            $songCount = 0;
            $slugs = [];

            foreach ($data['playlists'] as $slug => $pl) {
                $slug = (string) $slug;
                $pl = is_array($pl) ? $pl : [];
                $slugs[] = $slug;

                $color = $pl['color'] ?? '';
                $playlist = $user->playlists()->create([
                    'slug' => $slug,
                    'name' => (string) ($pl['name'] ?? $slug),
                    'color' => (is_string($color) && preg_match('/^#[0-9a-fA-F]{6}$/', $color)) ? $color : '#d4a574',
                    'current_index' => max(0, (int) ($pl['currentIndex'] ?? 0)),
                    'cover_song_index' => isset($pl['coverSongIndex']) ? max(0, (int) $pl['coverSongIndex']) : null,
                    'source' => (($pl['source'] ?? null) === 'spotify') ? 'spotify' : 'user',
                    'position' => $position++,
                ]);

                $songPosition = 0;
                foreach ((is_array($pl['songs'] ?? null) ? $pl['songs'] : []) as $song) {
                    if (! is_array($song)) {
                        continue;
                    }
                    $playlist->songs()->create([
                        'position' => $songPosition++,
                        'title' => (string) ($song['title'] ?? ''),
                        'artist' => (string) ($song['artist'] ?? ''),
                        'album' => (string) ($song['album'] ?? ''),
                        'cover' => $this->sanitizeUrl($song['cover'] ?? ''),
                        'youtube_id' => (string) ($song['youtube_id'] ?? ''),
                        'mp3_url' => $this->sanitizeUrl($song['mp3_url'] ?? ''),
                        'spotify_id' => (string) ($song['spotify_id'] ?? ''),
                    ]);
                    $songCount++;
                }
            }

            $active = $data['activePlaylist'] ?? null;
            $user->active_playlist_slug = (is_string($active) && in_array($active, $slugs, true))
                ? $active
                : ($slugs[0] ?? null);

            $recent = is_array($data['recentlyPlayed'] ?? null) ? $data['recentlyPlayed'] : [];
            $user->recently_played = array_values(array_filter($recent, 'is_string'));
            $user->save();

            return [count($slugs), $songCount];
        });

        $this->info("Imported {$playlistCount} playlists and {$songCount} songs for {$email}.");
        $this->line("Active playlist: {$user->active_playlist_slug}");

        return self::SUCCESS;
    }

    /**
     * Same allowlist as the save-music endpoint: http(s) absolute URLs and
     * root-relative paths only; everything else becomes ''.
     */
    private function sanitizeUrl(mixed $value): string
    {
        if ($value === null || $value === '' || ! is_scalar($value)) {
            return '';
        }
        $str = trim((string) $value);
        if ($str === '') {
            return '';
        }
        if (preg_match('#^https?://[^\s<>"\']+$#i', $str)) {
            return $str;
        }
        if (preg_match('#^/[^\s<>"\']*$#', $str)) {
            return $str;
        }

        return '';
    }
}
