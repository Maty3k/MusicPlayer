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
}
