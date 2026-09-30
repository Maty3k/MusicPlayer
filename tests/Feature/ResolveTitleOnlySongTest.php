<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/** A song imported with only a title and artist gets a playable match, and keeps it. */
class ResolveTitleOnlySongTest extends TestCase
{
    use RefreshDatabase;

    private function userWithSongs(array $songs): User
    {
        $user = User::forceCreate([
            'name' => 'Listener',
            'email' => uniqid().'@example.com',
            'password' => bcrypt('secret-password'),
            'email_verified_at' => now(),
        ]);
        $pl = $user->playlists()->create([
            'slug' => 'mix', 'name' => 'Mix', 'color' => '#d4a574',
            'current_index' => 0, 'source' => 'user', 'position' => 0,
        ]);
        foreach ($songs as $i => $s) {
            $pl->songs()->create(array_merge([
                'position' => $i, 'album' => '', 'cover' => '', 'youtube_id' => '', 'mp3_url' => '', 'spotify_id' => '',
            ], $s));
        }

        return $user;
    }

    private function fakeSearchResult(string $videoId): void
    {
        $data = ['contents' => ['x' => ['videoRenderer' => ['videoId' => $videoId]]]];
        Http::fake(['www.youtube.com/*' => Http::response('<script>var ytInitialData = '.json_encode($data).';</script>')]);
    }

    public function test_a_title_only_song_resolves_and_remembers_its_match(): void
    {
        $this->fakeSearchResult('abcdefghijk');
        $user = $this->userWithSongs([['title' => 'From the Start', 'artist' => 'Laufey']]);

        $this->actingAs($user)->postJson('/spotify-resolve', [
            'spotify_id' => '', 'title' => 'From the Start', 'artist' => 'Laufey',
            'playlist_key' => 'mix', 'song_index' => 0,
        ])->assertOk()->assertJson(['success' => true, 'youtube_id' => 'abcdefghijk']);

        $this->assertSame('abcdefghijk', $user->playlists()->first()->songs()->first()->youtube_id);
    }

    public function test_made_up_text_cannot_pin_a_video_onto_a_real_spotify_track(): void
    {
        $spotifyId = '4uLU6hMCjMI75M1A2tKUQC';
        $attacker = $this->userWithSongs([]);
        $victim = $this->userWithSongs([['title' => 'Real Title', 'artist' => 'Real Artist', 'spotify_id' => $spotifyId]]);

        // YouTube answers the real title with the right video, anything else with the attacker's.
        Http::fake(['www.youtube.com/*' => function ($request) {
            $id = str_contains(urldecode($request->url()), 'Real Title') ? 'correctVid1' : 'attackerVid';

            return Http::response('<script>var ytInitialData = '.json_encode(['v' => ['videoRenderer' => ['videoId' => $id]]]).';</script>');
        }]);

        // The attacker resolves the real id with text chosen to find their video.
        $this->actingAs($attacker)->postJson('/spotify-resolve', [
            'spotify_id' => $spotifyId, 'title' => 'something else entirely', 'artist' => 'whoever',
        ])->assertOk()->assertJson(['youtube_id' => 'attackerVid']);

        // The victim's own lookup (real title/artist) doesn't hit that entry.
        $this->actingAs($victim)->postJson('/spotify-resolve', [
            'spotify_id' => $spotifyId, 'title' => 'Real Title', 'artist' => 'Real Artist',
        ])->assertOk()->assertJson(['youtube_id' => 'correctVid1', 'cached' => false]);
    }

    public function test_it_will_not_overwrite_a_different_or_already_playable_song(): void
    {
        $this->fakeSearchResult('abcdefghijk');
        $user = $this->userWithSongs([
            ['title' => 'Real Song', 'artist' => 'Band', 'youtube_id' => 'keepThis123'],
            ['title' => 'Other Song', 'artist' => 'Band'],
        ]);

        // Song 0 already has a video; song 1 has a different title than the request.
        foreach ([0, 1] as $index) {
            $this->actingAs($user)->postJson('/spotify-resolve', [
                'spotify_id' => '', 'title' => 'Real Song', 'artist' => 'Band',
                'playlist_key' => 'mix', 'song_index' => $index,
            ])->assertOk()->assertJson(['success' => true]);
        }

        $songs = $user->playlists()->first()->songs()->orderBy('position')->get();
        $this->assertSame('keepThis123', $songs[0]->youtube_id);
        $this->assertSame('', $songs[1]->youtube_id);
    }
}
