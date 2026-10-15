<?php

namespace Tests\Feature;

use App\Models\Playlist;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Song edits by position also name the song (its key, as script.js's
 * songPlayKey makes it): a page that is out of date, opened offline or with
 * the list changed on another device, is refused instead of changing or
 * deleting another song. Pages that send no key work as before.
 */
class SongEditsCheckTheSongTest extends TestCase
{
    use RefreshDatabase;

    private function user(): User
    {
        return User::forceCreate([
            'name' => 'Curator',
            'email' => uniqid().'@example.com',
            'password' => bcrypt('secret-password'),
            'email_verified_at' => now(),
        ]);
    }

    /**
     * @param  array<int, string>  $videos
     */
    private function playlist(User $user, string $slug, array $videos): Playlist
    {
        $playlist = $user->playlists()->create([
            'slug' => $slug, 'name' => ucfirst($slug), 'color' => '#d4a574',
            'current_index' => 0, 'source' => 'user', 'position' => $user->playlists()->count(),
        ]);
        $user->update(['active_playlist_slug' => $user->active_playlist_slug ?? $slug]);
        foreach ($videos as $i => $video) {
            $playlist->songs()->create([
                'position' => $i, 'title' => 'Song '.$video, 'youtube_id' => $video,
                'cover' => 'https://i.ytimg.com/vi/'.$video.'/hqdefault.jpg',
            ]);
        }

        return $playlist;
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function save(User $user, array $data): TestResponse
    {
        return $this->actingAs($user)->postJson('/save-music', $data)->assertOk();
    }

    /**
     * @return array<int, string>
     */
    private function videos(Playlist $playlist): array
    {
        return $playlist->songs()->orderBy('position')->pluck('youtube_id')->all();
    }

    public function test_delete_removes_the_song_it_names(): void
    {
        $user = $this->user();
        $mix = $this->playlist($user, 'mix', ['aaa', 'bbb', 'ccc']);

        $this->save($user, ['action' => 'delete', 'playlist' => 'mix', 'index' => 1, 'key' => 'yt:bbb'])
            ->assertJson(['success' => true]);

        $this->assertSame(['aaa', 'ccc'], $this->videos($mix));
    }

    public function test_delete_from_an_out_of_date_list_is_refused(): void
    {
        // The page still shows aaa, bbb, ccc; on another device aaa was
        // removed, so position 1 is now ccc. Removing "bbb at 1" must not
        // remove ccc.
        $user = $this->user();
        $mix = $this->playlist($user, 'mix', ['bbb', 'ccc']);

        $this->save($user, ['action' => 'delete', 'playlist' => 'mix', 'index' => 1, 'key' => 'yt:bbb'])
            ->assertJson(['success' => false, 'error' => 'Invalid song index']);

        $this->assertSame(['bbb', 'ccc'], $this->videos($mix));
    }

    public function test_delete_without_a_key_works_as_before(): void
    {
        $user = $this->user();
        $mix = $this->playlist($user, 'mix', ['aaa', 'bbb']);

        $this->save($user, ['action' => 'delete', 'playlist' => 'mix', 'index' => 0])
            ->assertJson(['success' => true]);

        $this->assertSame(['bbb'], $this->videos($mix));
    }

    public function test_a_key_that_is_not_text_is_refused(): void
    {
        $user = $this->user();
        $mix = $this->playlist($user, 'mix', ['aaa']);

        $this->save($user, ['action' => 'delete', 'playlist' => 'mix', 'index' => 0, 'key' => ['yt:aaa']])
            ->assertJson(['success' => false]);

        $this->assertSame(['aaa'], $this->videos($mix));
    }

    public function test_copy_and_move_check_the_song(): void
    {
        $user = $this->user();
        $mix = $this->playlist($user, 'mix', ['aaa', 'bbb']);
        $other = $this->playlist($user, 'other', []);

        // Out of date: the page thinks bbb is at 0
        $this->save($user, ['action' => 'copySong', 'fromPlaylist' => 'mix', 'toPlaylist' => 'other', 'songIndex' => 0, 'key' => 'yt:bbb'])
            ->assertJson(['success' => false, 'error' => 'Invalid playlist or song index']);
        $this->save($user, ['action' => 'moveSong', 'fromPlaylist' => 'mix', 'toPlaylist' => 'other', 'songIndex' => 1, 'key' => 'yt:aaa'])
            ->assertJson(['success' => false, 'error' => 'Invalid playlist or song index']);
        $this->assertSame(['aaa', 'bbb'], $this->videos($mix));
        $this->assertSame([], $this->videos($other));

        // Right song
        $this->save($user, ['action' => 'copySong', 'fromPlaylist' => 'mix', 'toPlaylist' => 'other', 'songIndex' => 0, 'key' => 'yt:aaa'])
            ->assertJson(['success' => true]);
        $this->save($user, ['action' => 'moveSong', 'fromPlaylist' => 'mix', 'toPlaylist' => 'other', 'songIndex' => 1, 'key' => 'yt:bbb'])
            ->assertJson(['success' => true]);
        $this->assertSame(['aaa'], $this->videos($mix));
        $this->assertSame(['aaa', 'bbb'], $this->videos($other));
    }

    public function test_set_cover_checks_the_song(): void
    {
        $user = $this->user();
        $mix = $this->playlist($user, 'mix', ['aaa', 'bbb']);

        $this->save($user, ['action' => 'setCover', 'playlist' => 'mix', 'songIndex' => 1, 'key' => 'yt:aaa'])
            ->assertJson(['success' => false, 'error' => 'Invalid song index']);
        $this->assertNull($mix->fresh()->cover_song_index);

        $this->save($user, ['action' => 'setCover', 'playlist' => 'mix', 'songIndex' => 1, 'key' => 'yt:bbb'])
            ->assertJson(['success' => true]);
        $this->assertSame(1, (int) $mix->fresh()->cover_song_index);

        // Back to the automatic cover needs no song
        $this->save($user, ['action' => 'setCover', 'playlist' => 'mix', 'songIndex' => -1])
            ->assertJson(['success' => true]);
        $this->assertNull($mix->fresh()->cover_song_index);
    }

    public function test_reorder_checks_the_list_it_was_made_from(): void
    {
        $user = $this->user();
        $mix = $this->playlist($user, 'mix', ['aaa', 'bbb', 'ccc']);

        // Made from aaa, ccc, bbb (out of date): not applied
        $this->save($user, ['action' => 'reorder', 'playlist' => 'mix', 'order' => [2, 0, 1], 'keys' => ['yt:aaa', 'yt:ccc', 'yt:bbb']])
            ->assertJson(['success' => false, 'error' => 'Playlist changed']);
        // The wrong number of songs, or a missing one
        $this->save($user, ['action' => 'reorder', 'playlist' => 'mix', 'order' => [2, 0, 1], 'keys' => ['yt:aaa', 'yt:bbb']])
            ->assertJson(['success' => false]);
        $this->save($user, ['action' => 'reorder', 'playlist' => 'mix', 'order' => [2, 0, 1], 'keys' => ['yt:aaa', '', 'yt:ccc']])
            ->assertJson(['success' => false]);
        $this->assertSame(['aaa', 'bbb', 'ccc'], $this->videos($mix));

        // Made from the list as it is
        $this->save($user, ['action' => 'reorder', 'playlist' => 'mix', 'order' => [2, 0, 1], 'keys' => ['yt:aaa', 'yt:bbb', 'yt:ccc']])
            ->assertJson(['success' => true]);
        $this->assertSame(['ccc', 'aaa', 'bbb'], $this->videos($mix));

        // Without keys, as before
        $this->save($user, ['action' => 'reorder', 'playlist' => 'mix', 'order' => [1, 2, 0]])
            ->assertJson(['success' => true]);
        $this->assertSame(['aaa', 'bbb', 'ccc'], $this->videos($mix));
    }

    public function test_a_song_without_ids_matches_whatever_the_spacing_or_case(): void
    {
        $user = $this->user();
        $mix = $user->playlists()->create([
            'slug' => 'mix', 'name' => 'Mix', 'color' => '#d4a574',
            'current_index' => 0, 'source' => 'user', 'position' => 0,
        ]);
        // A no-break space PHP's trim keeps, and capitals: the page's key is
        // trimmed and lowercased by JavaScript's rules
        $mix->songs()->create(['position' => 0, 'title' => "Café Song\u{00A0}", 'artist' => 'Öre Band']);

        $this->save($user, ['action' => 'delete', 'playlist' => 'mix', 'index' => 0, 'key' => 'tt:café song|öre band'])
            ->assertJson(['success' => true]);

        $this->assertSame(0, $mix->songs()->count());
    }

    public function test_the_page_gives_each_cover_choice_its_song_key(): void
    {
        $user = $this->user();
        $this->playlist($user, 'mix', ['aaa', 'bbb']);

        $this->actingAs($user)->get('/')
            ->assertOk()
            ->assertSee('"key":"yt:aaa"', false)
            ->assertSee('"key":"yt:bbb"', false);
    }
}
