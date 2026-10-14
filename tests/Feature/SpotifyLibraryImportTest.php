<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\YoutubeMatch;
use Closure;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class SpotifyLibraryImportTest extends TestCase
{
    use RefreshDatabase;

    private function connectedUser(bool $expired = false): User
    {
        $user = User::forceCreate([
            'name' => 'Importer',
            'email' => uniqid().'@example.com',
            'password' => bcrypt('secret-password'),
            'email_verified_at' => now(),
        ]);
        $user->spotifyToken()->create([
            'access_token' => 'user-token',
            'refresh_token' => 'refresh-token',
            'expires_at' => $expired ? now()->subMinute() : now()->addHour(),
        ]);

        return $user;
    }

    /** A liked/playlist item wrapping a plain track with three cover sizes. */
    private function track(string $id, string $title, string $artist = 'Artist'): array
    {
        return [
            'is_local' => false,
            'track' => [
                'id' => $id,
                'type' => 'track',
                'name' => $title,
                'artists' => [['name' => $artist]],
                'album' => [
                    'name' => 'Album',
                    'images' => [
                        ['url' => "https://i.scdn.co/{$id}/640", 'width' => 640],
                        ['url' => "https://i.scdn.co/{$id}/300", 'width' => 300],
                        ['url' => "https://i.scdn.co/{$id}/64", 'width' => 64],
                    ],
                ],
            ],
        ];
    }

    /**
     * Fake a paged Spotify endpoint over a full item list, honouring the
     * offset/limit query like the real API. Takes the list by reference so a
     * test can change "what Spotify has" between calls.
     */
    private function paged(array &$items): Closure
    {
        return function (Request $request) use (&$items) {
            parse_str((string) parse_url($request->url(), PHP_URL_QUERY), $query);
            $offset = (int) ($query['offset'] ?? 0);
            $limit = (int) ($query['limit'] ?? 50);
            $next = $offset + $limit < count($items)
                ? 'https://api.spotify.com/v1/next?offset='.($offset + $limit)
                : null;

            return Http::response([
                'items' => array_slice($items, $offset, $limit),
                'total' => count($items),
                'next' => $next,
            ]);
        };
    }

    private function fakeLibrary(array $liked, array $playlists, array $tracksByPlaylist): void
    {
        $stubs = [
            'api.spotify.com/v1/me/tracks*' => $this->paged($liked),
            'api.spotify.com/v1/me/playlists*' => $this->paged($playlists),
        ];
        foreach ($tracksByPlaylist as $id => $tracks) {
            $stubs["api.spotify.com/v1/playlists/{$id}/tracks*"] = $this->paged($tracks);
            $name = collect($playlists)->firstWhere('id', $id)['name'] ?? 'Untitled';
            $stubs["api.spotify.com/v1/playlists/{$id}?*"] = Http::response(['name' => $name]);
        }
        $stubs['accounts.spotify.com/*'] = Http::response(['access_token' => 'fresh-token', 'expires_in' => 3600]);

        Http::fake($stubs);
    }

    public function test_requires_a_connected_spotify_account(): void
    {
        Http::fake();
        $user = User::forceCreate([
            'name' => 'Nobody',
            'email' => uniqid().'@example.com',
            'password' => bcrypt('secret-password'),
            'email_verified_at' => now(),
        ]);

        $this->actingAs($user)
            ->postJson('/spotify-library', ['action' => 'plan'])
            ->assertOk()
            ->assertJson(['success' => false]);

        Http::assertNothingSent();
    }

    public function test_plan_lists_liked_songs_then_every_playlist_in_spotify_order(): void
    {
        $this->fakeLibrary(
            liked: [$this->track('t1', 'One'), $this->track('t2', 'Two')],
            playlists: [
                ['id' => 'pl1', 'name' => 'Road Trip', 'tracks' => ['total' => 3]],
                ['id' => 'pl2', 'name' => 'Focus', 'tracks' => ['total' => 12]],
            ],
            tracksByPlaylist: [],
        );

        $sources = $this->actingAs($this->connectedUser())
            ->postJson('/spotify-library', ['action' => 'plan'])
            ->assertOk()
            ->assertJson(['success' => true])
            ->json('sources');

        $this->assertSame([
            ['kind' => 'liked', 'id' => '', 'name' => 'Liked Songs', 'total' => 2],
            ['kind' => 'playlist', 'id' => 'pl1', 'name' => 'Road Trip', 'total' => 3],
            ['kind' => 'playlist', 'id' => 'pl2', 'name' => 'Focus', 'total' => 12],
        ], $sources);
    }

    public function test_plan_omits_liked_songs_when_there_are_none(): void
    {
        $this->fakeLibrary([], [['id' => 'pl1', 'name' => 'Road Trip', 'tracks' => ['total' => 3]]], []);

        $sources = $this->actingAs($this->connectedUser())
            ->postJson('/spotify-library', ['action' => 'plan'])
            ->json('sources');

        $this->assertSame(['playlist'], array_column($sources, 'kind'));
    }

    public function test_imports_liked_songs_in_chunks_preserving_order(): void
    {
        $liked = [];
        for ($i = 1; $i <= 120; $i++) {
            $liked[] = $this->track("t{$i}", "Song {$i}");
        }
        $this->fakeLibrary($liked, [], []);
        $user = $this->connectedUser();

        // Two 50-track pages per call: 100 songs, then the remaining 20.
        $first = $this->actingAs($user)
            ->postJson('/spotify-library', ['action' => 'import', 'kind' => 'liked', 'offset' => 0])
            ->assertOk()
            ->json();
        $this->assertSame(
            ['success' => true, 'done' => false, 'next_offset' => 100, 'imported' => 100, 'slug' => 'spotify-liked'],
            $first,
        );

        $second = $this->actingAs($user)
            ->postJson('/spotify-library', ['action' => 'import', 'kind' => 'liked', 'offset' => 100])
            ->assertOk()
            ->json();
        $this->assertTrue($second['done']);
        $this->assertSame(20, $second['imported']);

        $playlist = $user->playlists()->where('slug', 'spotify-liked')->firstOrFail();
        $this->assertSame('Liked Songs', $playlist->name);
        $this->assertSame('spotify', $playlist->source);

        $songs = $playlist->songs()->orderBy('position')->get();
        $this->assertCount(120, $songs);
        $this->assertSame(range(0, 119), $songs->pluck('position')->all());
        $this->assertSame('Song 1', $songs->first()->title);
        $this->assertSame('Song 120', $songs->last()->title);
        $this->assertSame('t1', $songs->first()->spotify_id);
        // First cover of at least 300px (Spotify lists largest first), exactly
        // like the single-playlist import.
        $this->assertSame('https://i.scdn.co/t1/640', $songs->first()->cover);
    }

    public function test_imports_a_playlist_under_its_spotify_name_skipping_local_tracks_and_episodes(): void
    {
        $tracks = [
            $this->track('t1', 'Keep Me'),
            ['is_local' => true, 'track' => ['id' => null, 'type' => 'track', 'name' => 'Local File', 'artists' => [], 'album' => []]],
            ['is_local' => false, 'track' => ['id' => 'ep1', 'type' => 'episode', 'name' => 'Podcast', 'artists' => [], 'album' => []]],
            $this->track('t2', 'Also Me', 'Band'),
        ];
        $this->fakeLibrary([], [['id' => 'pl1', 'name' => 'Road Trip', 'tracks' => ['total' => 4]]], ['pl1' => $tracks]);
        // Someone already played t2 here, so its YouTube match is cached.
        YoutubeMatch::create(['spotify_id' => YoutubeMatch::cacheKey('t2', 'Also Me', 'Band'), 'youtube_id' => 'yyyyyyyyyyy']);
        $user = $this->connectedUser();

        $this->actingAs($user)
            ->postJson('/spotify-library', ['action' => 'import', 'kind' => 'playlist', 'id' => 'pl1', 'offset' => 0])
            ->assertOk()
            ->assertJson(['success' => true, 'done' => true, 'imported' => 2, 'slug' => 'spotify-pl1']);

        $playlist = $user->playlists()->where('slug', 'spotify-pl1')->firstOrFail();
        $this->assertSame('Road Trip', $playlist->name);
        $this->assertSame('spotify', $playlist->source);

        $songs = $playlist->songs()->orderBy('position')->get();
        $this->assertSame(['Keep Me', 'Also Me'], $songs->pluck('title')->all());
        $this->assertSame('Band', $songs[1]->artist);
        $this->assertSame('yyyyyyyyyyy', $songs[1]->youtube_id);
        $this->assertNull($songs[0]->youtube_id);
    }

    public function test_an_import_stops_at_the_library_ceilings_and_says_so(): void
    {
        $tracks = [$this->track('t1', 'One'), $this->track('t2', 'Two'), $this->track('t3', 'Three')];
        $this->fakeLibrary([], [
            ['id' => 'pl1', 'name' => 'Road Trip', 'tracks' => ['total' => 3]],
            ['id' => 'pl2', 'name' => 'Second', 'tracks' => ['total' => 3]],
        ], ['pl1' => $tracks, 'pl2' => $tracks]);
        $user = $this->connectedUser();
        config(['library.playlist_songs' => 2, 'library.playlists' => 1]);

        // Two of the three fit, and the answer says why the third did not
        $res = $this->actingAs($user)
            ->postJson('/spotify-library', ['action' => 'import', 'kind' => 'playlist', 'id' => 'pl1', 'offset' => 0])
            ->assertOk()->json();
        $this->assertFalse($res['success']);
        $this->assertStringContainsString('No room', $res['error']);
        $this->assertSame(2, $user->playlists()->where('slug', 'spotify-pl1')->firstOrFail()->songs()->count());

        // No second mirror once the account holds as many playlists as it may
        $res = $this->actingAs($user)
            ->postJson('/spotify-library', ['action' => 'import', 'kind' => 'playlist', 'id' => 'pl2', 'offset' => 0])
            ->assertOk()->json();
        $this->assertFalse($res['success']);
        $this->assertStringContainsString('playlists', $res['error']);
        $this->assertNull($user->playlists()->where('slug', 'spotify-pl2')->first());
    }

    public function test_reimporting_syncs_a_mirrored_playlist_instead_of_duplicating_it(): void
    {
        $tracks = [$this->track('t1', 'One'), $this->track('t2', 'Two'), $this->track('t3', 'Three')];
        Http::fake([
            'api.spotify.com/v1/playlists/pl1/tracks*' => $this->paged($tracks),
            'api.spotify.com/v1/playlists/pl1?*' => Http::response(['name' => 'Road Trip']),
        ]);
        $user = $this->connectedUser();
        $import = fn () => $this->actingAs($user)
            ->postJson('/spotify-library', ['action' => 'import', 'kind' => 'playlist', 'id' => 'pl1', 'offset' => 0])
            ->assertOk()
            ->assertJson(['success' => true]);

        $import();
        $playlist = $user->playlists()->where('slug', 'spotify-pl1')->firstOrFail();
        $playlist->update(['color' => '#123456']);

        // Spotify changed since: one track dropped, one added.
        $tracks = [$this->track('t1', 'One'), $this->track('t3', 'Three'), $this->track('t4', 'Four')];
        $import();

        $this->assertSame(1, $user->playlists()->where('slug', 'spotify-pl1')->count());
        $songs = $playlist->songs()->orderBy('position')->get();
        $this->assertSame(['One', 'Three', 'Four'], $songs->pluck('title')->all());
        $this->assertSame([0, 1, 2], $songs->pluck('position')->all());
        // The colour picked here survives a sync; only the songs mirror Spotify.
        $this->assertSame('#123456', $playlist->fresh()->color);
    }

    public function test_refreshes_an_expired_token_before_reading_the_library(): void
    {
        $this->fakeLibrary([$this->track('t1', 'One')], [], []);
        $user = $this->connectedUser(expired: true);

        $this->actingAs($user)
            ->postJson('/spotify-library', ['action' => 'plan'])
            ->assertOk()
            ->assertJson(['success' => true]);

        Http::assertSent(fn (Request $request) => str_contains($request->url(), 'accounts.spotify.com')
            && $request['grant_type'] === 'refresh_token');
        Http::assertSent(fn (Request $request) => str_contains($request->url(), '/me/tracks')
            && $request->hasHeader('Authorization', 'Bearer fresh-token'));
        $this->assertSame('fresh-token', $user->spotifyToken()->firstOrFail()->access_token);
    }

    public function test_reports_spotifys_retry_after_when_rate_limited(): void
    {
        Http::fake([
            'api.spotify.com/v1/playlists/pl1?*' => Http::response(['name' => 'Road Trip']),
            'api.spotify.com/v1/playlists/pl1/tracks*' => Http::response(['error' => 'slow down'], 429, ['Retry-After' => '7']),
        ]);
        $user = $this->connectedUser();

        $this->actingAs($user)
            ->postJson('/spotify-library', ['action' => 'import', 'kind' => 'playlist', 'id' => 'pl1', 'offset' => 0])
            ->assertOk()
            ->assertJson(['success' => false, 'retry_after' => 7]);

        // Nothing is written until a chunk's pages are all in hand.
        $this->assertFalse($user->playlists()->where('slug', 'spotify-pl1')->exists());
    }

    private function plainUser(): User
    {
        return User::forceCreate([
            'name' => 'Visitor',
            'email' => uniqid().'@example.com',
            'password' => bcrypt('secret-password'),
            'email_verified_at' => now(),
        ]);
    }

    public function test_plans_a_public_profile_with_the_app_credentials_and_skips_spotify_made_playlists(): void
    {
        $playlists = [
            ['id' => 'pl1', 'name' => 'Road Trip', 'owner' => ['id' => 'matei'], 'tracks' => ['total' => 3]],
            ['id' => 'dw', 'name' => 'Discover Weekly', 'owner' => ['id' => 'spotify'], 'tracks' => ['total' => 30]],
        ];
        Http::fake([
            'accounts.spotify.com/*' => Http::response(['access_token' => 'app-token', 'expires_in' => 3600]),
            'api.spotify.com/v1/users/matei/playlists*' => $this->paged($playlists),
        ]);

        $plan = $this->actingAs($this->plainUser())
            ->postJson('/spotify-library', ['action' => 'plan', 'profile' => 'https://open.spotify.com/user/matei?si=abc'])
            ->assertOk()
            ->assertJson(['success' => true, 'skipped' => 1])
            ->json();

        $this->assertSame([['kind' => 'playlist', 'id' => 'pl1', 'name' => 'Road Trip', 'total' => 3]], $plan['sources']);
        Http::assertSent(fn (Request $request) => str_contains($request->url(), 'accounts.spotify.com')
            && $request['grant_type'] === 'client_credentials');
        Http::assertSent(fn (Request $request) => str_contains($request->url(), '/users/matei/playlists')
            && $request->hasHeader('Authorization', 'Bearer app-token'));
    }

    public function test_imports_a_public_playlist_without_a_connected_account(): void
    {
        $tracks = [$this->track('t1', 'One'), $this->track('t2', 'Two')];
        Http::fake([
            'accounts.spotify.com/*' => Http::response(['access_token' => 'app-token', 'expires_in' => 3600]),
            'api.spotify.com/v1/playlists/pl1/tracks*' => $this->paged($tracks),
            'api.spotify.com/v1/playlists/pl1?*' => Http::response(['name' => 'Road Trip']),
        ]);
        $user = $this->plainUser();

        $this->actingAs($user)
            ->postJson('/spotify-library', ['action' => 'import', 'kind' => 'playlist', 'id' => 'pl1', 'offset' => 0])
            ->assertOk()
            ->assertJson(['success' => true, 'done' => true, 'imported' => 2, 'slug' => 'spotify-pl1']);

        $playlist = $user->playlists()->where('slug', 'spotify-pl1')->firstOrFail();
        $this->assertSame(['One', 'Two'], $playlist->songs()->orderBy('position')->pluck('title')->all());
    }

    public function test_liked_songs_still_need_a_connected_account(): void
    {
        Http::fake();

        $this->actingAs($this->plainUser())
            ->postJson('/spotify-library', ['action' => 'import', 'kind' => 'liked', 'offset' => 0])
            ->assertOk()
            ->assertJson(['success' => false]);

        Http::assertNothingSent();
    }

    public function test_rejects_a_link_that_is_not_a_profile(): void
    {
        Http::fake();
        $user = $this->connectedUser();

        foreach (['https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', 'not a profile!'] as $profile) {
            $this->actingAs($user)
                ->postJson('/spotify-library', ['action' => 'plan', 'profile' => $profile])
                ->assertOk()
                ->assertJson(['success' => false]);
        }

        Http::assertNothingSent();
    }

    public function test_rejects_malformed_import_requests_before_calling_spotify(): void
    {
        Http::fake();
        $user = $this->connectedUser();

        foreach ([
            ['action' => 'import', 'kind' => 'albums', 'offset' => 0],
            ['action' => 'import', 'kind' => 'playlist', 'id' => '../etc', 'offset' => 0],
            ['action' => 'import', 'kind' => 'playlist', 'offset' => 0],
            ['action' => 'import', 'kind' => 'liked', 'offset' => -5],
            ['action' => 'nope'],
        ] as $payload) {
            $this->actingAs($user)
                ->postJson('/spotify-library', $payload)
                ->assertOk()
                ->assertJson(['success' => false]);
        }

        Http::assertNothingSent();
    }
}
