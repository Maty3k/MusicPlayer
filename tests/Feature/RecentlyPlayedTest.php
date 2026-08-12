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

    public function test_play_count_accumulates_on_replay(): void
    {
        $user = $this->user();
        $this->record($user, ['title' => 'A', 'artist' => 'X', 'youtube_id' => 'aaaaaaaaaaa']);
        $this->record($user, ['title' => 'A', 'artist' => 'X', 'youtube_id' => 'aaaaaaaaaaa']);
        $this->record($user, ['title' => 'A', 'artist' => 'X', 'youtube_id' => 'aaaaaaaaaaa']);

        $this->assertSame(1, $user->plays()->count());
        $this->assertSame(3, (int) $user->plays()->firstOrFail()->play_count);
    }

    public function test_stats_rank_top_songs_and_artists_by_play_count(): void
    {
        $user = $this->user();
        // A x3 (Alpha), B x1 (Beta), C x2 (Alpha) → Alpha=5, Beta=1; A is top song.
        foreach (range(1, 3) as $_) {
            $this->record($user, ['title' => 'A', 'artist' => 'Alpha', 'youtube_id' => 'aaaaaaaaaaa']);
        }
        $this->record($user, ['title' => 'B', 'artist' => 'Beta', 'youtube_id' => 'bbbbbbbbbbb']);
        foreach (range(1, 2) as $_) {
            $this->record($user, ['title' => 'C', 'artist' => 'Alpha', 'youtube_id' => 'ccccccccccc']);
        }

        $stats = $this->actingAs($user)
            ->postJson('/save-music', ['action' => 'stats'])
            ->assertOk()
            ->json('stats');

        $this->assertSame(6, $stats['totalPlays']);
        $this->assertSame(3, $stats['distinctSongs']);
        $this->assertSame(2, $stats['distinctArtists']);
        $this->assertSame('A', $stats['topSongs'][0]['title']);
        $this->assertSame(3, $stats['topSongs'][0]['plays']);
        $this->assertSame('Alpha', $stats['topArtists'][0]['artist']);
        $this->assertSame(5, $stats['topArtists'][0]['plays']);
    }

    public function test_stats_scope_to_the_selected_time_range(): void
    {
        $user = $this->user();
        // 2 plays this week, 1 more within the month, 1 within the year.
        $user->playEvents()->create(['dedupe_key' => 'yt:aaaaaaaaaaa', 'title' => 'Recent', 'artist' => 'A', 'played_at' => now()->subDay()]);
        $user->playEvents()->create(['dedupe_key' => 'yt:aaaaaaaaaaa', 'title' => 'Recent', 'artist' => 'A', 'played_at' => now()->subDays(2)]);
        $user->playEvents()->create(['dedupe_key' => 'yt:bbbbbbbbbbb', 'title' => 'MidMonth', 'artist' => 'B', 'played_at' => now()->subDays(20)]);
        $user->playEvents()->create(['dedupe_key' => 'yt:ccccccccccc', 'title' => 'Old', 'artist' => 'C', 'played_at' => now()->subMonths(8)]);

        $range = fn (string $r) => $this->actingAs($user)
            ->postJson('/save-music', ['action' => 'stats', 'range' => $r])->json('stats');

        // Windowed ranges read the event log.
        $this->assertSame(2, $range('week')['totalPlays']);
        $this->assertSame(1, $range('week')['distinctSongs']);
        $this->assertSame(3, $range('month')['totalPlays']);
        $this->assertSame(2, $range('month')['distinctSongs']);
        $this->assertSame(4, $range('year')['totalPlays']);
    }

    public function test_all_time_stats_come_from_the_plays_table(): void
    {
        $user = $this->user();
        // Simulate an existing user at deploy: a plays row exists but the
        // event log is empty (no backfill) — all-time must still show it.
        $user->plays()->create([
            'dedupe_key' => 'yt:aaaaaaaaaaa', 'title' => 'Legacy', 'artist' => 'X',
            'play_count' => 7, 'played_at' => now()->subYears(2),
        ]);
        $this->assertSame(0, $user->playEvents()->count());

        $stats = $this->actingAs($user)
            ->postJson('/save-music', ['action' => 'stats', 'range' => 'all'])
            ->json('stats');

        $this->assertSame(7, $stats['totalPlays']);
        $this->assertSame(1, $stats['distinctSongs']);
        $this->assertSame(1, $stats['distinctArtists']);
        $this->assertSame('Legacy', $stats['topSongs'][0]['title']);
        $this->assertSame(7, $stats['topSongs'][0]['plays']);

        // An unknown range falls back to all-time (also from the plays table).
        $bogus = $this->actingAs($user)
            ->postJson('/save-music', ['action' => 'stats', 'range' => 'zzz'])
            ->json('stats');
        $this->assertSame(7, $bogus['totalPlays']);
    }

    public function test_stats_are_scoped_per_user(): void
    {
        $me = $this->user();
        $other = $this->user();
        $this->record($other, ['title' => 'Theirs', 'artist' => 'Z', 'youtube_id' => 'zzzzzzzzzzz']);

        $stats = $this->actingAs($me)
            ->postJson('/save-music', ['action' => 'stats'])
            ->assertOk()
            ->json('stats');

        $this->assertSame(0, $stats['totalPlays']);
        $this->assertSame([], $stats['topSongs']);
        $this->assertSame([], $stats['topArtists']);
    }
}
