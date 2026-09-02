<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The manual "add" action must never store a song that nothing can play, and
 * only well-formed YouTube / Spotify ids may reach the players.
 */
class AddSongSourceTest extends TestCase
{
    use RefreshDatabase;

    private function userWithPlaylist(): User
    {
        $user = User::forceCreate([
            'name' => 'Adder',
            'email' => uniqid().'@example.com',
            'password' => bcrypt('secret-password'),
            'email_verified_at' => now(),
        ]);
        $user->playlists()->create([
            'slug' => 'faves', 'name' => 'Faves', 'color' => '#d4a574',
            'current_index' => 0, 'source' => 'user', 'position' => 0,
        ]);
        $user->forceFill(['active_playlist_slug' => 'faves'])->save();

        return $user;
    }

    private function add(User $user, array $song): array
    {
        return $this->actingAs($user)
            ->postJson('/save-music', ['action' => 'add', 'song' => $song])
            ->assertOk()
            ->json();
    }

    public function test_rejects_a_song_with_nothing_to_play(): void
    {
        $user = $this->userWithPlaylist();

        // A pasted Spotify link saved as a "YouTube id" (the old client bug),
        // and a Spotify-mode add that lost its id: neither has a source.
        foreach ([
            ['title' => 'Junk', 'youtube_id' => 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC'],
            ['title' => 'Metadata only', 'artist' => 'Someone'],
            ['title' => 'Bad ids', 'youtube_id' => 'short', 'spotify_id' => 'not-a-spotify-id'],
        ] as $song) {
            $result = $this->add($user, $song);
            $this->assertFalse($result['success'], json_encode($song));
        }

        $this->assertSame(0, $user->playlists()->first()->songs()->count());
    }

    public function test_stores_a_well_formed_spotify_id(): void
    {
        $user = $this->userWithPlaylist();

        $result = $this->add($user, ['title' => 'Track', 'artist' => 'Band', 'spotify_id' => '4uLU6hMCjMI75M1A2tKUQC']);

        $this->assertTrue($result['success']);
        $song = $user->playlists()->first()->songs()->first();
        $this->assertSame('4uLU6hMCjMI75M1A2tKUQC', $song->spotify_id);
        $this->assertSame('', $song->youtube_id);
    }

    public function test_stores_a_well_formed_youtube_id(): void
    {
        $user = $this->userWithPlaylist();

        $result = $this->add($user, ['title' => 'Video', 'youtube_id' => 'dQw4w9WgXcQ']);

        $this->assertTrue($result['success']);
        $this->assertSame('dQw4w9WgXcQ', $user->playlists()->first()->songs()->first()->youtube_id);
    }

    public function test_blanks_a_malformed_id_but_keeps_the_song_when_an_mp3_url_remains(): void
    {
        $user = $this->userWithPlaylist();

        $result = $this->add($user, [
            'title' => 'File',
            'youtube_id' => 'https://example.com/not-a-video',
            'mp3_url' => 'https://example.com/song.mp3',
        ]);

        $this->assertTrue($result['success']);
        $song = $user->playlists()->first()->songs()->first();
        $this->assertSame('', $song->youtube_id);
        $this->assertSame('https://example.com/song.mp3', $song->mp3_url);
    }
}
