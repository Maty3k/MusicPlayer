<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RecentlyPlayedTest extends TestCase
{
    use RefreshDatabase;

    private function user(): User
    {
        return User::forceCreate([
            'name' => 'Listener',
            'email' => uniqid().'@example.com',
            'password' => bcrypt('secret-password'),
            'email_verified_at' => now(),
        ]);
    }

    private function record(User $user, array $song): void
    {
        $this->actingAs($user)
            ->postJson('/save-music', ['action' => 'recordPlay', 'song' => $song])
            ->assertOk()
            ->assertJson(['success' => true]);
    }

    public function test_records_a_play_and_returns_it_in_recent_songs(): void
    {
        $user = $this->user();
        $this->record($user, ['title' => 'Aloy\'s Theme', 'artist' => 'Joris de Man', 'youtube_id' => 'abcdefghijk']);

        $songs = $this->actingAs($user)
            ->postJson('/save-music', ['action' => 'getAll'])
            ->assertOk()
            ->json('recentSongs');

        $this->assertCount(1, $songs);
        $this->assertSame('Aloy\'s Theme', $songs[0]['title']);
        $this->assertSame('Joris de Man', $songs[0]['artist']);
        $this->assertSame('abcdefghijk', $songs[0]['youtube_id']);
    }

    public function test_replaying_a_song_dedupes_and_moves_it_to_the_front(): void
    {
        $user = $this->user();
        $this->record($user, ['title' => 'First', 'youtube_id' => 'aaaaaaaaaaa']);
        $this->record($user, ['title' => 'Second', 'youtube_id' => 'bbbbbbbbbbb']);
        // Replay the first — should NOT create a second row, and should jump to front.
        $this->record($user, ['title' => 'First', 'youtube_id' => 'aaaaaaaaaaa']);

        $this->assertSame(2, $user->plays()->count());

        $songs = $this->actingAs($user)
            ->postJson('/save-music', ['action' => 'getAll'])
            ->json('recentSongs');

        $this->assertCount(2, $songs);
        $this->assertSame('First', $songs[0]['title']);
        $this->assertSame('Second', $songs[1]['title']);
    }

    public function test_blanks_a_malformed_youtube_id_and_unsafe_urls(): void
    {
        $user = $this->user();
        $this->record($user, [
            'title' => 'Sketchy',
            'youtube_id' => '"><script>alert(1)</script>',
            'cover' => 'javascript:alert(1)',
            'mp3_url' => 'file:///etc/passwd',
        ]);

        $play = $user->plays()->firstOrFail();
        $this->assertSame('', $play->youtube_id);
        $this->assertSame('', $play->cover);
        $this->assertSame('', $play->mp3_url);
    }

    public function test_clamps_overlong_fields_instead_of_erroring(): void
    {
        $user = $this->user();
        $long = str_repeat('a', 500);
        // On a strict DB (prod Postgres) an unclamped insert would 500 here.
        $this->record($user, [
            'title' => $long,
            'artist' => $long,
            'album' => $long,
            'spotify_id' => str_repeat('b', 60),
        ]);

        $play = $user->plays()->firstOrFail();
        $this->assertSame(300, mb_strlen($play->title));
        $this->assertSame(300, mb_strlen($play->artist));
        $this->assertSame(300, mb_strlen($play->album));
        $this->assertSame(40, mb_strlen($play->spotify_id));
    }

    public function test_rejects_a_play_with_no_title(): void
    {
        $this->actingAs($this->user())
            ->postJson('/save-music', ['action' => 'recordPlay', 'song' => ['artist' => 'Nobody']])
            ->assertOk()
            ->assertJson(['success' => false]);
    }

    public function test_recent_songs_is_capped_at_twelve(): void
    {
        $user = $this->user();
        for ($i = 0; $i < 15; $i++) {
            $this->record($user, ['title' => "Song {$i}", 'youtube_id' => str_pad((string) $i, 11, 'x')]);
        }

        $songs = $this->actingAs($user)
            ->postJson('/save-music', ['action' => 'getAll'])
            ->json('recentSongs');

        $this->assertCount(12, $songs);
        // Newest first: the last recorded song leads.
        $this->assertSame('Song 14', $songs[0]['title']);
    }

    public function test_recent_songs_are_scoped_per_user(): void
    {
        $me = $this->user();
        $other = $this->user();
        $this->record($other, ['title' => 'Not Mine', 'youtube_id' => 'zzzzzzzzzzz']);

        $songs = $this->actingAs($me)
            ->postJson('/save-music', ['action' => 'getAll'])
            ->json('recentSongs');

        $this->assertSame([], $songs);
    }

    public function test_requires_authentication(): void
    {
        $this->postJson('/save-music', ['action' => 'recordPlay', 'song' => ['title' => 'x']])
            ->assertRedirect();
    }
}
