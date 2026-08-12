<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class FavoritesTest extends TestCase
{
    use RefreshDatabase;

    private function user(): User
    {
        return User::forceCreate([
            'name' => 'Fan',
            'email' => uniqid().'@example.com',
            'password' => bcrypt('secret-password'),
            'email_verified_at' => now(),
        ]);
    }

    private function toggle(User $user, array $song)
    {
        return $this->actingAs($user)
            ->postJson('/save-music', ['action' => 'favorite', 'song' => $song])
            ->assertOk();
    }

    public function test_favoriting_creates_the_favorites_playlist_and_adds_the_song(): void
    {
        $user = $this->user();
        $this->toggle($user, ['title' => 'Aloy\'s Theme', 'artist' => 'Joris de Man', 'youtube_id' => 'aaaaaaaaaaa'])
            ->assertJson(['success' => true, 'favorited' => true]);

        $fav = $user->playlists()->where('slug', 'favorites')->firstOrFail();
        $this->assertSame(1, $fav->songs()->count());
        $this->assertSame('Aloy\'s Theme', $fav->songs()->firstOrFail()->title);
    }

    public function test_favoriting_twice_toggles_it_off(): void
    {
        $user = $this->user();
        $song = ['title' => 'Odyssey', 'artist' => 'X', 'youtube_id' => 'bbbbbbbbbbb'];
        $this->toggle($user, $song)->assertJson(['favorited' => true]);
        $this->toggle($user, $song)->assertJson(['favorited' => false]);

        $fav = $user->playlists()->where('slug', 'favorites')->firstOrFail();
        $this->assertSame(0, $fav->songs()->count());
    }

    public function test_unfavorites_by_identity_even_if_payload_differs(): void
    {
        $user = $this->user();
        // Same youtube_id, different title text — should still match and remove.
        $this->toggle($user, ['title' => 'Song (Official Video)', 'artist' => 'A', 'youtube_id' => 'ccccccccccc'])
            ->assertJson(['favorited' => true]);
        $this->toggle($user, ['title' => 'Song', 'artist' => 'A', 'youtube_id' => 'ccccccccccc'])
            ->assertJson(['favorited' => false]);

        $this->assertSame(0, $user->playlists()->where('slug', 'favorites')->firstOrFail()->songs()->count());
    }

    public function test_favorite_keys_are_returned_in_get_all(): void
    {
        $user = $this->user();
        $this->toggle($user, ['title' => 'A', 'artist' => 'X', 'youtube_id' => 'aaaaaaaaaaa']);
        $this->toggle($user, ['title' => 'B', 'artist' => 'Y', 'youtube_id' => 'bbbbbbbbbbb']);

        $keys = $this->actingAs($user)
            ->postJson('/save-music', ['action' => 'getAll'])
            ->json('favoriteKeys');

        $this->assertContains('yt:aaaaaaaaaaa', $keys);
        $this->assertContains('yt:bbbbbbbbbbb', $keys);
    }

    public function test_favorites_are_scoped_per_user(): void
    {
        $me = $this->user();
        $other = $this->user();
        $this->toggle($other, ['title' => 'Theirs', 'artist' => 'Z', 'youtube_id' => 'zzzzzzzzzzz']);

        $keys = $this->actingAs($me)
            ->postJson('/save-music', ['action' => 'getAll'])
            ->json('favoriteKeys');

        $this->assertSame([], $keys);
    }

    public function test_requires_authentication(): void
    {
        $this->postJson('/save-music', ['action' => 'favorite', 'song' => ['title' => 'x']])
            ->assertRedirect();
    }

    public function test_favorite_key_uses_the_verbatim_youtube_id(): void
    {
        $user = $this->user();
        // A non-canonical id (as addSong stores verbatim) must key as yt:<id>,
        // not tt:..., or the heart desyncs against the source row on reload.
        $this->toggle($user, ['title' => 'Weird', 'artist' => 'X', 'youtube_id' => 'shortid'])
            ->assertJson(['favorited' => true]);

        $keys = $this->actingAs($user)
            ->postJson('/save-music', ['action' => 'getAll'])
            ->json('favoriteKeys');

        $this->assertContains('yt:shortid', $keys);
    }

    public function test_unfavorite_shifts_current_index_for_an_earlier_removal(): void
    {
        $user = $this->user();
        $fav = $user->playlists()->create([
            'slug' => 'favorites', 'name' => 'Favorites', 'color' => '#d4a574',
            'current_index' => 3, 'source' => 'user', 'position' => 0,
        ]);
        foreach (['A', 'B', 'C', 'D'] as $i => $t) {
            $fav->songs()->create(['position' => $i, 'title' => $t, 'youtube_id' => str_pad((string) $i, 11, 'x')]);
        }

        // Un-favorite A (index 0), before the current index (3).
        $this->toggle($user, ['title' => 'A', 'youtube_id' => str_pad('0', 11, 'x')])
            ->assertJson(['favorited' => false]);

        $this->assertSame(2, (int) $fav->fresh()->current_index);
    }
}
