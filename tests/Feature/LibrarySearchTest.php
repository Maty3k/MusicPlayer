<?php

namespace Tests\Feature;

use App\Models\Playlist;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class LibrarySearchTest extends TestCase
{
    use RefreshDatabase;

    private function user(): User
    {
        return User::forceCreate([
            'name' => 'Searcher',
            'email' => uniqid().'@example.com',
            'password' => bcrypt('secret-password'),
            'email_verified_at' => now(),
        ]);
    }

    private function playlistWithSongs(User $user, string $slug, string $name, array $songs): Playlist
    {
        $pl = $user->playlists()->create([
            'slug' => $slug, 'name' => $name, 'color' => '#d4a574',
            'current_index' => 0, 'source' => 'user', 'position' => 0,
        ]);
        foreach ($songs as $i => $s) {
            $pl->songs()->create(['position' => $i, 'title' => $s[0], 'artist' => $s[1] ?? '']);
        }

        return $pl;
    }

    private function search(User $user, string $q)
    {
        return $this->actingAs($user)
            ->postJson('/save-music', ['action' => 'searchLibrary', 'q' => $q])
            ->assertOk();
    }

    public function test_finds_songs_across_all_playlists(): void
    {
        $user = $this->user();
        $this->playlistWithSongs($user, 'rock', 'Rock', [['Thunder', 'AC/DC'], ['Rain', 'X']]);
        $this->playlistWithSongs($user, 'chill', 'Chill', [['Thunderstruck', 'AC/DC']]);

        $results = $this->search($user, 'thunder')->json('results');

        $titles = array_column($results, 'title');
        sort($titles);
        $this->assertSame(['Thunder', 'Thunderstruck'], $titles);
        // Each result carries its home playlist + position for replay.
        $byTitle = collect($results)->keyBy('title');
        $this->assertSame('rock', $byTitle['Thunder']['playlistSlug']);
        $this->assertSame('chill', $byTitle['Thunderstruck']['playlistSlug']);
        $this->assertSame(0, $byTitle['Thunderstruck']['position']);
    }

    public function test_matches_artist_too(): void
    {
        $user = $this->user();
        $this->playlistWithSongs($user, 'p', 'P', [['Some Song', 'Laufey'], ['Other', 'Nobody']]);

        $results = $this->search($user, 'laufey')->json('results');
        $this->assertCount(1, $results);
        $this->assertSame('Some Song', $results[0]['title']);
    }

    public function test_short_queries_return_nothing(): void
    {
        $user = $this->user();
        $this->playlistWithSongs($user, 'p', 'P', [['A', 'B']]);
        $this->assertSame([], $this->search($user, 'a')->json('results'));
    }

    public function test_is_scoped_per_user(): void
    {
        $me = $this->user();
        $other = $this->user();
        $this->playlistWithSongs($other, 'p', 'P', [['Secret Track', 'Them']]);

        $this->assertSame([], $this->search($me, 'secret')->json('results'));
    }

    public function test_requires_authentication(): void
    {
        $this->postJson('/save-music', ['action' => 'searchLibrary', 'q' => 'test'])
            ->assertRedirect();
    }

    public function test_matches_a_literal_percent(): void
    {
        $user = $this->user();
        $this->playlistWithSongs($user, 'p', 'P', [['50% Off', 'X'], ['Full Price', 'Y']]);

        // Without a working ESCAPE clause, % would act as a wildcard and match both.
        $results = $this->search($user, '50%')->json('results');
        $this->assertCount(1, $results);
        $this->assertSame('50% Off', $results[0]['title']);
    }
}
