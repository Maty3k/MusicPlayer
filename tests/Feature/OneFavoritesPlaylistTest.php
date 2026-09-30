<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** The welcome wizard's "Favorites" and the heart button share one playlist. */
class OneFavoritesPlaylistTest extends TestCase
{
    use RefreshDatabase;

    private function newUser(): User
    {
        return User::forceCreate([
            'name' => 'Newcomer',
            'email' => uniqid().'@example.com',
            'password' => bcrypt('secret-password'),
            'email_verified_at' => now(),
        ]);
    }

    public function test_hearting_a_song_fills_the_wizard_made_favorites(): void
    {
        $user = $this->newUser();

        $this->actingAs($user)->postJson('/save-music', ['action' => 'createPlaylist', 'name' => 'Favorites'])
            ->assertOk()->assertJson(['success' => true, 'playlistId' => 'favorites']);

        $this->actingAs($user)->postJson('/save-music', [
            'action' => 'favorite',
            'song' => ['title' => 'Tune', 'artist' => 'Band', 'youtube_id' => 'aaaaaaaaaaa'],
        ])->assertOk()->assertJson(['success' => true]);

        $this->assertSame(1, $user->playlists()->count());
        $this->assertSame(1, $user->playlists()->where('slug', 'favorites')->first()->songs()->count());
    }

    public function test_a_second_favorites_or_any_other_name_gets_its_own_slug(): void
    {
        $user = $this->newUser();
        $this->actingAs($user)->postJson('/save-music', ['action' => 'createPlaylist', 'name' => 'favorites']);

        $again = $this->actingAs($user)->postJson('/save-music', ['action' => 'createPlaylist', 'name' => 'Favorites'])
            ->assertOk()->json('playlistId');
        $other = $this->actingAs($user)->postJson('/save-music', ['action' => 'createPlaylist', 'name' => 'Road Trip'])
            ->assertOk()->json('playlistId');

        $this->assertStringStartsWith('pl-', $again);
        $this->assertStringStartsWith('pl-', $other);
    }
}
