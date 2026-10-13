<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Disconnecting Spotify changes something, so only a POST does it. As a GET,
 * a song cover or a plain link pointing at it disconnected whoever opened it.
 */
class SpotifyDisconnectTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_link_cannot_disconnect_spotify_but_the_button_can(): void
    {
        $user = User::forceCreate([
            'name' => 'Listener',
            'email' => 'listener@example.com',
            'password' => bcrypt('secret-password'),
            'email_verified_at' => now(),
        ]);
        $user->spotifyToken()->create([
            'access_token' => 'access', 'refresh_token' => 'refresh', 'expires_at' => now()->addHour(),
        ]);

        $this->actingAs($user)->get('/spotify?action=logout')->assertJson(['error' => 'Unknown action']);
        $this->assertNotNull($user->fresh()->spotifyToken);

        $this->actingAs($user)->postJson('/spotify', ['action' => 'logout'])
            ->assertOk()->assertJson(['success' => true]);
        $this->assertNull($user->fresh()->spotifyToken);
    }
}
