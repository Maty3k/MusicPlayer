<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

// Phones show a playlist without making it the playing one ('getPlaylist'),
// and start it with a targeted 'switch' that may also make it the active one.
class PhoneBrowsingTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::forceCreate([
            'name' => 'Browser',
            'email' => 'browser@example.com',
            'password' => bcrypt('secret-password'),
            'email_verified_at' => now(),
        ]);
        $songs = ['favorites' => 3, 'gym' => 2, 'road' => 1, 'calm' => 1, 'late' => 1, 'empty' => 0];
        $pos = 0;
        foreach ($songs as $slug => $n) {
            $pl = $this->user->playlists()->create(['slug' => $slug, 'name' => ucfirst($slug), 'position' => $pos++, 'current_index' => 0]);
            for ($i = 0; $i < $n; $i++) {
                $pl->songs()->create(['position' => $i, 'title' => ucfirst($slug).' '.$i, 'artist' => 'A', 'album' => '', 'cover' => '', 'youtube_id' => substr(md5($slug.$i), 0, 11), 'mp3_url' => '', 'spotify_id' => '']);
            }
        }
        $this->playlist('favorites')->update(['current_index' => 2]);
        $this->playlist('gym')->update(['current_index' => 1]);
        $this->user->update(['active_playlist_slug' => 'favorites', 'recently_played' => ['favorites', 'road']]);
    }

    private function playlist(string $slug)
    {
        return $this->user->playlists()->where('slug', $slug)->first();
    }

    private function save(array $body)
    {
        return $this->actingAs($this->user)->postJson('/save-music', $body);
    }

    /** Active slug, recents and every resume point, to compare before/after. */
    private function state(): array
    {
        $u = $this->user->fresh();

        return [
            'active' => $u->active_playlist_slug,
            'recent' => $u->recently_played,
            'indexes' => $u->playlists()->orderBy('position')->pluck('current_index', 'slug')->map(fn ($v) => (int) $v)->all(),
        ];
    }

    public function test_get_playlist_returns_the_playlist_and_changes_nothing(): void
    {
        $before = $this->state();

        $this->save(['action' => 'getPlaylist', 'playlist' => 'gym'])->assertOk()->assertJson([
            'success' => true,
            'playlistId' => 'gym',
            'playlist' => ['name' => 'Gym', 'currentIndex' => 1, 'songs' => [['title' => 'Gym 0'], ['title' => 'Gym 1']]],
        ]);
        $this->save(['action' => 'getPlaylist', 'playlist' => 'empty'])->assertOk()
            ->assertJson(['success' => true, 'playlist' => ['songs' => []]]);

        $this->assertSame($before, $this->state());
    }

    public function test_get_playlist_refuses_bad_or_foreign_slugs(): void
    {
        $other = User::forceCreate(['name' => 'Other', 'email' => 'other@example.com', 'password' => bcrypt('x-password'), 'email_verified_at' => now()]);
        $other->playlists()->create(['slug' => 'theirs', 'name' => 'Theirs', 'position' => 0]);
        $before = $this->state();

        foreach ([['playlist' => 'theirs'], ['playlist' => 'nope'], [], ['playlist' => null], ['playlist' => ['x']]] as $extra) {
            $this->save(array_merge(['action' => 'getPlaylist'], $extra))->assertOk()
                ->assertExactJson(['success' => false, 'error' => 'Invalid playlist']);
        }

        $this->assertSame($before, $this->state());
    }

    public function test_the_page_still_renders_the_playing_playlist_after_a_view(): void
    {
        $this->save(['action' => 'getPlaylist', 'playlist' => 'gym'])->assertJson(['success' => true]);

        $this->actingAs($this->user)->get('/')->assertOk()->assertSee("let activePlaylistId = 'favorites';", false);
    }

    public function test_switch_without_a_playlist_still_saves_into_the_active_one(): void
    {
        $this->save(['action' => 'switch', 'index' => 1])->assertOk()->assertExactJson(['success' => true]);

        $this->assertSame(1, (int) $this->playlist('favorites')->current_index);
        $this->assertSame(1, (int) $this->playlist('gym')->current_index);
        $this->assertSame('favorites', $this->user->fresh()->active_playlist_slug);

        $this->save(['action' => 'switch', 'index' => 7])->assertJson(['success' => false, 'error' => 'Invalid song index']);
        $this->assertSame(1, (int) $this->playlist('favorites')->current_index);
    }

    public function test_switch_with_a_playlist_only_moves_that_playlists_resume_point(): void
    {
        $this->save(['action' => 'switch', 'playlist' => 'gym', 'index' => 0])->assertOk()->assertExactJson(['success' => true]);

        $state = $this->state();
        $this->assertSame(0, $state['indexes']['gym']);
        $this->assertSame(2, $state['indexes']['favorites']);
        $this->assertSame('favorites', $state['active'], 'without activate the active playlist stays');
        $this->assertSame(['favorites', 'road'], $state['recent'], 'without activate the recents stay');
    }

    public function test_switch_with_activate_makes_the_playlist_active_and_bumps_recents(): void
    {
        $this->save(['action' => 'switch', 'playlist' => 'gym', 'index' => 0, 'activate' => true])->assertOk()
            ->assertExactJson(['success' => true, 'recentlyPlayed' => ['gym', 'favorites', 'road']]);

        $state = $this->state();
        $this->assertSame('gym', $state['active']);
        $this->assertSame(0, $state['indexes']['gym']);
        $this->assertSame(2, $state['indexes']['favorites']);

        // Deduped and capped at four, newest first.
        foreach (['calm', 'late', 'road'] as $slug) {
            $this->save(['action' => 'switch', 'playlist' => $slug, 'index' => 0, 'activate' => true])->assertJson(['success' => true]);
        }
        $this->assertSame(['road', 'late', 'calm', 'gym'], $this->user->fresh()->recently_played);
        $this->assertSame('road', $this->user->fresh()->active_playlist_slug);

        $this->actingAs($this->user)->get('/')->assertOk()->assertSee("let activePlaylistId = 'road';", false);
    }

    public function test_activating_the_active_playlist_leaves_the_recents_alone(): void
    {
        $this->user->update(['recently_played' => ['gym', 'favorites']]);

        $this->save(['action' => 'switch', 'playlist' => 'favorites', 'index' => 1, 'activate' => true])->assertOk()
            ->assertJson(['success' => true]);

        $state = $this->state();
        $this->assertSame(1, $state['indexes']['favorites']);
        $this->assertSame('favorites', $state['active']);
        $this->assertSame(['gym', 'favorites'], $state['recent']);
    }

    public function test_switch_with_an_out_of_range_index_writes_nothing(): void
    {
        $before = $this->state();

        $this->save(['action' => 'switch', 'playlist' => 'gym', 'index' => 5, 'activate' => true])
            ->assertJson(['success' => false, 'error' => 'Invalid song index']);
        $this->save(['action' => 'switch', 'playlist' => 'gym', 'index' => -1])->assertJson(['success' => false]);
        $this->save(['action' => 'switch', 'playlist' => 'empty', 'index' => 0, 'activate' => true])->assertJson(['success' => false]);

        $this->assertSame($before, $this->state());
    }

    public function test_switch_refuses_bad_or_foreign_playlists_without_falling_back(): void
    {
        $other = User::forceCreate(['name' => 'Other', 'email' => 'other@example.com', 'password' => bcrypt('x-password'), 'email_verified_at' => now()]);
        $theirs = $other->playlists()->create(['slug' => 'theirs', 'name' => 'Theirs', 'position' => 0, 'current_index' => 0]);
        $theirs->songs()->create(['position' => 0, 'title' => 'T', 'artist' => 'A', 'album' => '', 'cover' => '', 'youtube_id' => 'tttttttttt1', 'mp3_url' => '', 'spotify_id' => '']);
        $theirs->songs()->create(['position' => 1, 'title' => 'U', 'artist' => 'A', 'album' => '', 'cover' => '', 'youtube_id' => 'tttttttttt2', 'mp3_url' => '', 'spotify_id' => '']);
        $before = $this->state();

        foreach (['theirs', 'nope', '', ['x'], null] as $slug) {
            $this->save(['action' => 'switch', 'playlist' => $slug, 'index' => 0, 'activate' => true])
                ->assertJson(['success' => false]);
        }

        $this->assertSame($before, $this->state(), 'a refused switch never lands on the active playlist');
        $this->assertSame(0, (int) $theirs->fresh()->current_index);
        $this->assertSame(null, $other->fresh()->active_playlist_slug);
    }
}
