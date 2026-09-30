<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/** Imports never cut a list short without saying so. */
class ImportLimitsTest extends TestCase
{
    use RefreshDatabase;

    private function user(bool $spotify = false): User
    {
        $user = User::forceCreate([
            'name' => 'Importer',
            'email' => uniqid().'@example.com',
            'password' => bcrypt('secret-password'),
            'email_verified_at' => now(),
        ]);
        if ($spotify) {
            $user->spotifyToken()->create([
                'access_token' => 'user-token',
                'refresh_token' => 'refresh-token',
                'expires_at' => now()->addHour(),
            ]);
        }

        return $user;
    }

    /** Fake one Spotify playlist: its info (claimed total) and its readable tracks. */
    private function fakeSpotifyPlaylist(int $claimedTotal, int $readable): void
    {
        $items = [];
        for ($i = 0; $i < $readable; $i++) {
            $items[] = ['track' => [
                'id' => sprintf('%022d', $i),
                'name' => "Song {$i}",
                'artists' => [['name' => 'Artist']],
                'album' => ['name' => 'Album', 'images' => []],
                'duration_ms' => 200000,
            ]];
        }

        Http::fake([
            'api.spotify.com/v1/playlists/PL123/tracks*' => function (Request $request) use ($items) {
                parse_str((string) parse_url($request->url(), PHP_URL_QUERY), $query);
                $offset = (int) ($query['offset'] ?? 0);
                $limit = (int) ($query['limit'] ?? 100);

                return Http::response([
                    'items' => array_slice($items, $offset, $limit),
                    'total' => count($items),
                    'next' => $offset + $limit < count($items) ? 'next' : null,
                ]);
            },
            'api.spotify.com/v1/playlists/PL123*' => Http::response([
                'name' => 'Big One', 'images' => [], 'tracks' => ['total' => $claimedTotal],
            ]),
        ]);
    }

    public function test_spotify_link_returns_every_song_and_the_playlist_total(): void
    {
        $this->fakeSpotifyPlaylist(claimedTotal: 260, readable: 250);

        $res = $this->actingAs($this->user(spotify: true))->postJson('/spotify', [
            'action' => 'import_url', 'url' => 'https://open.spotify.com/playlist/PL123',
        ])->assertOk()->assertJson(['success' => true, 'total' => 250, 'playlistTotal' => 260]);

        $this->assertCount(250, $res->json('songs'));
    }

    public function test_spotify_link_explains_a_playlist_it_wont_share(): void
    {
        $this->fakeSpotifyPlaylist(claimedTotal: 40, readable: 0);

        $res = $this->actingAs($this->user(spotify: true))->postJson('/spotify', [
            'action' => 'import_url', 'url' => 'https://open.spotify.com/playlist/PL123',
        ])->assertOk()->assertJson(['success' => false]);

        $this->assertStringContainsString('playlists you own', $res->json('error'));
    }

    /** Spotify rate-limits from `$failFrom` onwards (offset), serving pages before that. */
    private function fakeRateLimitedPlaylist(int $total, int $failFrom): void
    {
        Http::fake([
            'api.spotify.com/v1/playlists/PL123/tracks*' => function (Request $request) use ($total, $failFrom) {
                parse_str((string) parse_url($request->url(), PHP_URL_QUERY), $query);
                $offset = (int) ($query['offset'] ?? 0);
                if ($offset >= $failFrom) {
                    return Http::response('', 429, ['Retry-After' => '7']);
                }
                $items = [];
                for ($i = $offset; $i < min($total, $offset + 100); $i++) {
                    $items[] = ['track' => ['id' => sprintf('%022d', $i), 'name' => "Song {$i}", 'artists' => [['name' => 'A']], 'album' => ['images' => []]]];
                }

                return Http::response(['items' => $items, 'next' => $offset + 100 < $total ? 'next' : null]);
            },
            'api.spotify.com/v1/playlists/PL123*' => Http::response(['name' => 'Big One', 'images' => [], 'tracks' => ['total' => $total]]),
        ]);
    }

    public function test_a_busy_spotify_says_try_again_not_that_the_playlist_is_private(): void
    {
        $this->fakeRateLimitedPlaylist(total: 300, failFrom: 0);

        $res = $this->actingAs($this->user(spotify: true))->postJson('/spotify', [
            'action' => 'import_url', 'url' => 'https://open.spotify.com/playlist/PL123',
        ])->assertOk()->assertJson(['success' => false, 'retry_after' => 7]);

        $this->assertStringContainsString('busy', $res->json('error'));
        $this->assertStringNotContainsString('you own', $res->json('error'));
    }

    public function test_a_read_cut_short_by_spotify_is_marked_incomplete(): void
    {
        $this->fakeRateLimitedPlaylist(total: 300, failFrom: 100);

        $this->actingAs($this->user(spotify: true))->postJson('/spotify', [
            'action' => 'import_url', 'url' => 'https://open.spotify.com/playlist/PL123',
        ])->assertOk()->assertJson(['success' => true, 'total' => 100, 'playlistTotal' => 300, 'incomplete' => true]);
    }

    public function test_copying_a_shared_playlist_keeps_more_than_200_songs(): void
    {
        $owner = $this->user();
        $pl = $owner->playlists()->create([
            'slug' => 'big', 'name' => 'Big Share', 'color' => '#d4a574',
            'current_index' => 0, 'source' => 'user', 'position' => 0, 'share_token' => 'bigsharetoken',
        ]);
        for ($i = 0; $i < 250; $i++) {
            $pl->songs()->create([
                'position' => $i, 'title' => "T{$i}", 'artist' => 'A', 'album' => '',
                'cover' => '', 'youtube_id' => sprintf('v%010d', $i), 'mp3_url' => '', 'spotify_id' => '',
            ]);
        }

        $me = $this->user();
        $this->actingAs($me)->post('/s/bigsharetoken/add')->assertRedirect('/');

        $copy = $me->playlists()->where('name', 'Big Share')->first();
        $this->assertSame(250, $copy->songs()->count());
    }
}
