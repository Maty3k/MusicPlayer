<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** "Save this playlist" on a share page survives signing in or signing up. */
class SaveSharedThroughSignInTest extends TestCase
{
    use RefreshDatabase;

    private function user(): User
    {
        return User::forceCreate([
            'name' => 'Someone',
            'email' => uniqid().'@example.com',
            'password' => bcrypt('secret-password'),
            'email_verified_at' => now(),
        ]);
    }

    private function sharedPlaylist(User $owner, string $token = 'shareme12345'): void
    {
        $pl = $owner->playlists()->create([
            'slug' => 'road', 'name' => 'Road Trip', 'color' => '#d4a574',
            'current_index' => 0, 'source' => 'user', 'position' => 0, 'share_token' => $token,
        ]);
        $pl->songs()->create([
            'position' => 0, 'title' => 'Tune', 'artist' => 'Band', 'album' => '',
            'cover' => '', 'youtube_id' => 'aaaaaaaaaaa', 'mp3_url' => '', 'spotify_id' => '',
        ]);
    }

    public function test_the_share_page_links_to_login_with_the_playlist(): void
    {
        $this->sharedPlaylist($this->user());

        $this->get('/s/shareme12345')->assertOk()->assertSee('/login?save=shareme12345', false);
    }

    public function test_a_playlist_saved_before_signing_in_is_offered_on_arrival(): void
    {
        $this->sharedPlaylist($this->user());
        $newcomer = $this->user();

        // Guest clicks "Save this playlist" → login page remembers it.
        $this->get('/login?save=shareme12345')->assertOk();
        $this->assertSame('shareme12345', session('pending_share')['token']);

        // Signed in (by any route), they land on the player and are asked —
        // a ?save= link could come from anyone, so nothing is copied yet.
        $this->actingAs($newcomer)->get('/')->assertOk()
            ->assertSee('Save “Road Trip” (1 song) to your library?', false)
            ->assertSee('/s/shareme12345/add', false);
        $this->assertSame(0, $newcomer->playlists()->where('name', 'Road Trip')->count());

        // Their click saves it, and the offer isn't repeated.
        $this->actingAs($newcomer)->post('/s/shareme12345/add')->assertRedirect('/');
        $this->assertSame(1, $newcomer->playlists()->where('name', 'Road Trip')->first()->songs()->count());
        $this->actingAs($newcomer)->get('/')->assertOk()->assertDontSee('to your library?', false);
    }

    public function test_the_offer_expires(): void
    {
        $this->sharedPlaylist($this->user());
        $this->get('/login?save=shareme12345');
        $this->travel(16)->minutes();

        $this->actingAs($this->user())->get('/')->assertOk()->assertDontSee('to your library?', false);
    }

    public function test_unknown_tokens_malformed_input_and_your_own_playlist_are_not_offered(): void
    {
        $owner = $this->user();
        $this->sharedPlaylist($owner);

        $this->get('/login?save=doesnotexist99')->assertOk();
        $this->assertNull(session('pending_share'));
        $this->get('/login?save[]=shareme12345')->assertOk();
        $this->assertNull(session('pending_share'));

        $this->get('/login?save=shareme12345');
        $this->actingAs($owner)->get('/')->assertOk()->assertDontSee('to your library?', false);
    }
}
