<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class FirstRunTest extends TestCase
{
    use RefreshDatabase;

    public function test_registration_creates_no_bootstrap_playlist(): void
    {
        $this->post('/register', [
            'name' => 'Fresh Listener',
            'email' => 'fresh@example.com',
            'password' => 'brand-new-password',
            'password_confirmation' => 'brand-new-password',
        ])->assertRedirect(route('verification.notice'));

        $user = User::where('email', 'fresh@example.com')->firstOrFail();
        $this->assertSame(0, $user->playlists()->count());
        $this->assertNull($user->active_playlist_slug);
    }

    public function test_player_renders_for_a_playlistless_account(): void
    {
        $user = User::forceCreate([
            'name' => 'Fresh',
            'email' => 'fresh@example.com',
            'password' => bcrypt('brand-new-password'),
            'email_verified_at' => now(),
        ]);

        // The crate renders with the wizard's empty state instead of erroring
        $this->actingAs($user)->get('/')
            ->assertOk()
            ->assertSee('playlistWizardHint');
    }

    public function test_first_created_playlist_becomes_the_active_one(): void
    {
        $user = User::forceCreate([
            'name' => 'Fresh',
            'email' => 'fresh@example.com',
            'password' => bcrypt('brand-new-password'),
            'email_verified_at' => now(),
        ]);

        $res = $this->actingAs($user)->postJson('/save-music', [
            'action' => 'createPlaylist', 'name' => 'Favorites', 'color' => '#d4a574',
        ]);
        $res->assertOk()->assertJson(['success' => true]);

        // activeSlug() falls back to the first playlist, so the player opens it
        $this->actingAs($user)->get('/')->assertOk()->assertSee('Favorites');
    }
}
