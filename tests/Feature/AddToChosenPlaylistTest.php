<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

// 'add' with a `playlist`: the phone's "Add songs to" picker sends songs to a
// playlist that isn't the one open, without moving the open one.
class AddToChosenPlaylistTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::forceCreate([
            'name' => 'Picker',
            'email' => 'picker@example.com',
            'password' => bcrypt('secret-password'),
            'email_verified_at' => now(),
        ]);
        foreach (['favorites' => 'Favorites', 'gym' => 'Gym'] as $slug => $name) {
            $this->user->playlists()->create(['slug' => $slug, 'name' => $name, 'position' => 0, 'current_index' => 0]);
        }
        $this->user->update(['active_playlist_slug' => 'favorites']);
        $fav = $this->user->playlists()->where('slug', 'favorites')->first();
        $fav->songs()->create(['position' => 0, 'title' => 'Open One', 'artist' => 'A', 'album' => '', 'cover' => '', 'youtube_id' => 'aaaaaaaaaa1', 'mp3_url' => '', 'spotify_id' => '']);
        $fav->songs()->create(['position' => 1, 'title' => 'Open Two', 'artist' => 'A', 'album' => '', 'cover' => '', 'youtube_id' => 'aaaaaaaaaa2', 'mp3_url' => '', 'spotify_id' => '']);
        $fav->update(['current_index' => 1]);
    }

    private function add(array $extra)
    {
        return $this->actingAs($this->user)->postJson('/save-music', array_merge([
            'action' => 'add',
            'song' => ['title' => 'New Song', 'artist' => 'B', 'youtube_id' => 'bbbbbbbbbb1'],
        ], $extra));
    }

    public function test_a_chosen_playlist_gets_the_song_and_the_open_one_is_untouched(): void
    {
        $this->add(['playlist' => 'gym'])->assertOk()->assertJson(['success' => true, 'index' => 0]);

        $gym = $this->user->playlists()->where('slug', 'gym')->first();
        $fav = $this->user->playlists()->where('slug', 'favorites')->first();
        $this->assertSame(['New Song'], $gym->songs()->orderBy('position')->pluck('title')->all());
        $this->assertSame(0, (int) $gym->current_index, 'a playlist that is not open keeps its resume point');
        $this->assertSame(2, $fav->songs()->count());
        $this->assertSame(1, (int) $fav->fresh()->current_index);
        $this->assertSame('favorites', $this->user->fresh()->active_playlist_slug);
    }

    public function test_choosing_the_open_playlist_adds_there_without_moving_what_plays(): void
    {
        $this->add(['playlist' => 'favorites'])->assertOk()->assertJson(['success' => true, 'index' => 2]);
        $this->assertSame(1, (int) $this->user->playlists()->where('slug', 'favorites')->first()->current_index);
    }

    public function test_a_plain_add_still_makes_the_new_song_current(): void
    {
        $this->add([])->assertOk()->assertJson(['success' => true, 'index' => 2]);
        $this->assertSame(2, (int) $this->user->playlists()->where('slug', 'favorites')->first()->current_index);
    }

    public function test_an_upload_links_to_its_song_in_the_chosen_playlist(): void
    {
        $gym = $this->user->playlists()->where('slug', 'gym')->first();
        $gym->songs()->create(['position' => 0, 'title' => 'Run', 'artist' => 'C', 'album' => '', 'cover' => '', 'youtube_id' => 'cccccccccc1', 'mp3_url' => '', 'spotify_id' => '']);

        $this->add(['playlist' => 'gym', 'link' => true, 'song' => ['title' => 'Run', 'artist' => 'C', 'mp3_url' => '/media/run.mp3']])
            ->assertOk()->assertJson(['success' => true, 'linked' => true, 'index' => 0]);

        $this->assertSame('/media/run.mp3', $gym->songs()->first()->mp3_url);
        $this->assertSame(1, $gym->songs()->count());
    }

    public function test_someone_elses_or_unknown_playlist_is_refused(): void
    {
        $other = User::forceCreate(['name' => 'Other', 'email' => 'other@example.com', 'password' => bcrypt('x-password'), 'email_verified_at' => now()]);
        $other->playlists()->create(['slug' => 'theirs', 'name' => 'Theirs', 'position' => 0]);

        $this->add(['playlist' => 'theirs'])->assertJson(['success' => false, 'error' => 'Invalid playlist']);
        $this->add(['playlist' => 'nope'])->assertJson(['success' => false]);
        $this->add(['playlist' => ['x']])->assertJson(['success' => false]);
        $this->assertSame(0, $other->playlists()->first()->songs()->count());
    }

    public function test_favorites_is_created_when_chosen_before_it_exists(): void
    {
        $this->user->playlists()->where('slug', 'favorites')->first()->songs()->delete();
        $this->user->playlists()->where('slug', 'favorites')->delete();
        $this->user->update(['active_playlist_slug' => 'gym']);

        $this->add(['playlist' => 'favorites'])->assertOk()->assertJson(['success' => true, 'index' => 0]);
        $this->assertSame(1, $this->user->playlists()->where('slug', 'favorites')->first()->songs()->count());
        $this->assertSame('gym', $this->user->fresh()->active_playlist_slug);
    }
}
