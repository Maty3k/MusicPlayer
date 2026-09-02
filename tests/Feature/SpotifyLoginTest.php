<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class SpotifyLoginTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'services.spotify.client_id' => 'client-id',
            'services.spotify.client_secret' => 'client-secret',
            'services.spotify.redirect_uri' => 'http://localhost/spotify?action=callback',
        ]);
    }

    private function fakeSpotify(array $me = []): void
    {
        Http::fake([
            'accounts.spotify.com/*' => Http::response([
                'access_token' => 'user-token',
                'refresh_token' => 'refresh-token',
                'expires_in' => 3600,
            ]),
            'api.spotify.com/v1/me' => Http::response($me + [
                'id' => 'spotify-matei',
                'display_name' => 'Matei',
                'email' => 'matei@example.com',
            ]),
        ]);
    }

    /** Hit the OAuth callback with a state that matches the session. */
    private function hitCallback(string $flow = 'login')
    {
        return $this->withSession(['spotify_state' => 'state-123', 'spotify_flow' => $flow])
            ->get('/spotify?action=callback&code=auth-code&state=state-123');
    }

    private function emailUser(string $email = 'matei@example.com'): User
    {
        return User::forceCreate([
            'name' => 'Existing',
            'email' => $email,
            'password' => bcrypt('secret-password'),
            'email_verified_at' => now(),
        ]);
    }

    public function test_login_page_offers_spotify_only_when_configured(): void
    {
        $this->get('/login')->assertOk()->assertSee('Continue with Spotify');

        config(['services.spotify.client_id' => null]);
        $this->get('/login')->assertOk()->assertDontSee('Continue with Spotify');
    }

    public function test_continue_with_spotify_sends_the_visitor_to_the_consent_screen(): void
    {
        $response = $this->get('/auth/spotify');

        $response->assertRedirect()->assertSessionHas('spotify_flow', 'login');
        $location = (string) $response->headers->get('Location');
        $this->assertStringStartsWith('https://accounts.spotify.com/authorize?', $location);
        $this->assertStringContainsString('user-library-read', $location);
        $this->assertStringContainsString('state='.$this->app['session.store']->get('spotify_state'), $location);
    }

    public function test_continue_with_spotify_is_unavailable_when_not_configured(): void
    {
        config(['services.spotify.client_id' => null]);

        $this->get('/auth/spotify')->assertRedirect(route('login'))->assertSessionHasErrors('spotify');
    }

    public function test_callback_creates_an_account_and_signs_it_in(): void
    {
        $this->fakeSpotify();

        $this->hitCallback()->assertRedirect('/?spotify=signed-in');

        $user = User::query()->where('spotify_user_id', 'spotify-matei')->firstOrFail();
        $this->assertAuthenticatedAs($user);
        $this->assertSame('Matei', $user->name);
        // Spotify's email claim is unverified, so it is not adopted as the account email.
        $this->assertNull($user->email);
        $this->assertSame('user-token', $user->spotifyToken()->firstOrFail()->access_token);
    }

    public function test_callback_signs_in_the_account_already_linked(): void
    {
        $this->fakeSpotify();
        $linked = User::forceCreate(['name' => 'Linked', 'password' => bcrypt('x'), 'spotify_user_id' => 'spotify-matei']);

        $this->hitCallback()->assertRedirect('/?spotify=signed-in');

        $this->assertAuthenticatedAs($linked);
        $this->assertSame(1, User::count());
    }

    public function test_callback_never_matches_an_account_by_email(): void
    {
        $this->fakeSpotify(['email' => 'victim@example.com']);
        $victim = $this->emailUser('victim@example.com');

        $this->hitCallback()->assertRedirect('/?spotify=signed-in');

        $this->assertSame(2, User::count());
        $this->assertNotSame($victim->id, auth()->id());
        $this->assertNull($victim->fresh()->spotify_user_id);
    }

    public function test_callback_rejects_a_bad_state(): void
    {
        $this->fakeSpotify();

        $this->withSession(['spotify_state' => 'state-123', 'spotify_flow' => 'login'])
            ->get('/spotify?action=callback&code=auth-code&state=wrong')
            ->assertRedirect(route('login'))
            ->assertSessionHasErrors('spotify');

        $this->assertGuest();
        $this->assertSame(0, User::count());
        Http::assertNothingSent();
    }

    public function test_connecting_from_settings_links_the_spotify_account(): void
    {
        $this->fakeSpotify();
        $user = $this->emailUser();

        $this->actingAs($user)->hitCallback('connect')->assertRedirect('/?spotify=connected');

        $this->assertSame('spotify-matei', $user->fresh()->spotify_user_id);
        $this->assertAuthenticatedAs($user);
    }

    public function test_connecting_cannot_take_over_a_spotify_account_linked_elsewhere(): void
    {
        $this->fakeSpotify();
        User::forceCreate(['name' => 'First', 'password' => bcrypt('x'), 'spotify_user_id' => 'spotify-matei']);
        $second = $this->emailUser();

        $this->actingAs($second)->hitCallback('connect')->assertRedirect('/?spotify=connected');

        $this->assertNull($second->fresh()->spotify_user_id);
        // The token is still stored, so imports and playback work for this account too.
        $this->assertNotNull($second->spotifyToken()->first());
    }

    public function test_spotify_accounts_can_use_the_player_without_an_email(): void
    {
        $user = User::forceCreate(['name' => 'Spotify listener', 'password' => bcrypt('x'), 'spotify_user_id' => 'spotify-matei']);

        $this->actingAs($user)->get('/')->assertOk();
    }

    public function test_other_spotify_actions_still_require_a_signed_in_user(): void
    {
        $this->get('/spotify?action=status')->assertStatus(401);
    }
}
