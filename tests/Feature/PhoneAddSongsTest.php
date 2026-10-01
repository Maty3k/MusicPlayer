<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

// The phone's Add songs sheet and the import sheet, as the server renders
// them: what shows depends on whether Spotify and cover recognition are set up.
class PhoneAddSongsTest extends TestCase
{
    use RefreshDatabase;

    private function page()
    {
        $user = User::forceCreate([
            'name' => 'Adder',
            'email' => uniqid().'@example.com',
            'password' => bcrypt('a-long-password'),
            'email_verified_at' => now(),
        ]);

        return $this->actingAs($user)->get('/')->assertOk();
    }

    public function test_add_songs_has_a_to_line_rows_and_collapsed_details(): void
    {
        $this->page()
            ->assertSee('<h2 class="add-song-modal-title" id="addSongModalTitle">Add songs</h2>', false)
            ->assertSee('id="mAddToBtn"', false)
            ->assertSee('data-m-addsong="import"', false)
            ->assertSee('data-m-addsong="files"', false)
            ->assertSee('<summary>Enter details manually</summary>', false)
            ->assertSee('data-m-add="songs"', false)
            ->assertDontSee('data-m-pl="scan"', false);
    }

    public function test_without_spotify_the_import_sheet_offers_no_spotify(): void
    {
        config(['services.spotify.client_id' => null]);

        $this->page()
            ->assertDontSee('data-tab="spotify"', false)
            ->assertDontSee('id="spotifyImportUrl"', false)
            ->assertDontSee('Liked Songs and private playlists')
            ->assertSee('id="importSpotifyPane"', false)
            ->assertSee('const spotifyOn = false;', false)
            ->assertSee('<small>A YouTube link or a pasted list</small>', false);
    }

    public function test_with_spotify_the_profile_import_sits_behind_a_disclosure(): void
    {
        config(['services.spotify.client_id' => 'client-id']);

        $this->page()
            ->assertSee('data-tab="spotify"', false)
            ->assertSee('const spotifyOn = true;', false)
            ->assertSeeInOrder(['id="spotifyProfileDetails"', '<summary>Import everything from a profile</summary>', 'id="spotifyProfileUrl"'], false);
    }

    public function test_snap_a_cover_only_when_cover_recognition_is_set_up(): void
    {
        config(['services.gemini.key' => null]);
        $this->page()->assertDontSee('data-m-addsong="snap"', false);

        config(['services.gemini.key' => 'gemini-key']);
        $this->page()->assertSee('data-m-addsong="snap"', false);
    }
}
