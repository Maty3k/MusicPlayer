<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

// "Where's your music now?": the chooser for bringing a library over from
// another app, as the server renders it. script.js opens it (on a new
// account's first load, and from the entries below); here it's closed.
class BringMusicOverTest extends TestCase
{
    use RefreshDatabase;

    private function user(): User
    {
        return User::forceCreate([
            'name' => 'Mover',
            'email' => uniqid().'@example.com',
            'password' => bcrypt('a-long-password'),
            'email_verified_at' => now(),
        ]);
    }

    public function test_the_chooser_is_on_the_page_closed_with_every_way_in(): void
    {
        $this->actingAs($this->user())->get('/')
            ->assertOk()
            // closed: no "active" class until script.js opens it
            ->assertSee('<div class="add-song-modal m-menu-sheet bring-modal" id="bringMusicModal" role="dialog" aria-modal="true" aria-labelledby="bringMusicTitle">', false)
            ->assertSee('<h2 class="m-sheet-title" id="bringMusicTitle">Where&rsquo;s your music now?</h2>', false)
            ->assertSeeInOrder(['data-bring="spotify"', 'data-bring="apple"', 'data-bring="youtube"', 'data-bring="files"', 'data-bring="fresh"'], false)
            ->assertSee('<div class="bring-pane" id="bringStepSpotify" hidden>', false)
            ->assertSee('<div class="bring-pane" id="bringStepApple" hidden>', false)
            ->assertSee('data-bring="paste"', false)
            ->assertSee('<input type="file" id="bringFilesInput" multiple', false);
    }

    public function test_the_permanent_entries_are_there_for_every_account(): void
    {
        $user = $this->user();
        $pl = $user->playlists()->create(['slug' => 'favorites', 'name' => 'Favorites', 'position' => 0, 'current_index' => 0]);
        $pl->songs()->create(['position' => 0, 'title' => 'Kept', 'artist' => 'A', 'album' => '', 'cover' => '', 'youtube_id' => 'aaaaaaaaaa1', 'mp3_url' => '', 'spotify_id' => '']);

        $this->actingAs($user)->get('/')
            ->assertOk()
            ->assertSee('id="mYouBring"', false)        // phone You page
            ->assertSee('data-m-add="bring"', false)    // phone Library +
            ->assertSee('id="crateBringTile"', false)   // desktop crate
            // songs already: no empty-collection card
            ->assertDontSee('id="crateEmptyHint"', false)
            ->assertDontSee('id="crateEmptyBring"', false);
    }

    public function test_an_empty_library_gets_the_chooser_on_its_empty_card(): void
    {
        $user = $this->user();
        $user->playlists()->create(['slug' => 'favorites', 'name' => 'Favorites', 'position' => 0, 'current_index' => 0]);

        $this->actingAs($user)->get('/')
            ->assertOk()
            ->assertSee('id="crateEmptyHint"', false)
            ->assertSee('id="crateEmptyBring" onclick="showBringMusicModal()"', false);
    }

    public function test_without_spotify_the_spotify_way_goes_through_youtube_music(): void
    {
        config(['services.spotify.client_id' => null]);

        $this->actingAs($this->user())->get('/')
            ->assertOk()
            ->assertSee('<small>Copy it to YouTube Music first, then paste the link</small>', false);
    }

    public function test_with_spotify_the_spotify_way_is_a_link(): void
    {
        config(['services.spotify.client_id' => 'client-id']);

        $this->actingAs($this->user())->get('/')
            ->assertOk()
            ->assertSee('<b>Spotify</b><small>Paste a playlist link</small>', false);
    }
}
