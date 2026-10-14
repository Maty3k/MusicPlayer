<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\SharedPlaylistCopier;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Accounts are free and instant, so each one can only hold so much (see
 * config/library.php) and can only write so fast. A ceiling is always said
 * out loud: nothing is cut short quietly.
 */
class LibraryLimitsTest extends TestCase
{
    use RefreshDatabase;

    /** A verified account with one empty playlist, "mix", that is the active one. */
    private function user(): User
    {
        $user = User::forceCreate([
            'name' => 'Collector',
            'email' => uniqid().'@example.com',
            'password' => bcrypt('secret-password'),
            'email_verified_at' => now(),
        ]);
        $user->playlists()->create([
            'slug' => 'mix', 'name' => 'Mix', 'color' => '#d4a574',
            'current_index' => 0, 'source' => 'user', 'position' => 0,
        ]);
        $user->forceFill(['active_playlist_slug' => 'mix'])->save();

        return $user;
    }

    private function save(User $user, array $body): array
    {
        return $this->actingAs($user)->postJson('/save-music', $body)->assertOk()->json();
    }

    private function song(string $letter): array
    {
        return ['title' => 'Song '.$letter, 'artist' => 'Band', 'youtube_id' => str_repeat($letter, 11)];
    }

    public function test_an_address_longer_than_the_limit_is_not_stored(): void
    {
        $user = $this->user();
        $long = 'https://img.example/'.str_repeat('a', 2000);

        $res = $this->save($user, ['action' => 'add', 'song' => $this->song('a') + ['cover' => $long]]);
        $this->assertTrue($res['success']);
        $this->assertSame('', (string) $user->playlists()->first()->songs()->first()->cover);

        // As a song's only source it leaves nothing to play: refused
        $res = $this->save($user, ['action' => 'add', 'song' => ['title' => 'File', 'mp3_url' => $long]]);
        $this->assertFalse($res['success']);
        $this->assertSame(1, $user->playlists()->first()->songs()->count());
    }

    public function test_a_full_playlist_takes_no_more_songs(): void
    {
        config(['library.playlist_songs' => 2]);
        $user = $this->user();

        $this->assertTrue($this->save($user, ['action' => 'add', 'song' => $this->song('a')])['success']);
        $this->assertTrue($this->save($user, ['action' => 'add', 'song' => $this->song('b')])['success']);

        $res = $this->save($user, ['action' => 'add', 'song' => $this->song('c')]);
        $this->assertFalse($res['success']);
        $this->assertStringContainsString('No room', $res['error']);
        $this->assertSame(2, $user->playlists()->first()->songs()->count());
    }

    public function test_a_batch_that_does_not_fit_is_refused_whole(): void
    {
        config(['library.playlist_songs' => 3]);
        $user = $this->user();
        $songs = [$this->song('a'), $this->song('b'), $this->song('c'), $this->song('d')];

        $res = $this->save($user, ['action' => 'addBatch', 'newPlaylist' => 'Import', 'songs' => $songs]);
        $this->assertFalse($res['success']);
        $this->assertStringContainsString('No room', $res['error']);
        // Refused before the playlist was made: no empty one is left behind
        $this->assertSame(1, $user->playlists()->count());

        $res = $this->save($user, ['action' => 'addBatch', 'newPlaylist' => 'Import', 'songs' => array_slice($songs, 0, 3)]);
        $this->assertTrue($res['success']);
        $this->assertSame(3, $res['added']);

        // The next chunk of the same import no longer fits either
        $res = $this->save($user, ['action' => 'addBatch', 'playlist' => $res['playlistId'], 'songs' => [$songs[3]]]);
        $this->assertFalse($res['success']);
    }

    public function test_the_library_as_a_whole_has_a_ceiling(): void
    {
        config(['library.songs' => 2]);
        $user = $this->user();
        $user->playlists()->create([
            'slug' => 'other', 'name' => 'Other', 'color' => '#d4a574',
            'current_index' => 0, 'source' => 'user', 'position' => 1,
        ]);

        $this->assertTrue($this->save($user, ['action' => 'add', 'song' => $this->song('a')])['success']);
        $this->assertTrue($this->save($user, ['action' => 'add', 'playlist' => 'other', 'song' => $this->song('b')])['success']);

        // Either playlist has room of its own; the library does not
        $this->assertFalse($this->save($user, ['action' => 'add', 'song' => $this->song('c')])['success']);
        $this->assertFalse($this->save($user, ['action' => 'copySong', 'fromPlaylist' => 'mix', 'toPlaylist' => 'other', 'songIndex' => 0])['success']);
        $this->assertFalse($this->save($user, ['action' => 'favorite', 'song' => $this->song('c')])['success']);

        // Moving adds nothing, so it still works
        $this->assertTrue($this->save($user, ['action' => 'moveSong', 'fromPlaylist' => 'mix', 'toPlaylist' => 'other', 'songIndex' => 0])['success']);
    }

    public function test_an_account_holds_only_so_many_playlists(): void
    {
        config(['library.playlists' => 2]);
        $user = $this->user();

        $this->assertTrue($this->save($user, ['action' => 'createPlaylist', 'name' => 'Second', 'color' => '#d4a574'])['success']);

        $res = $this->save($user, ['action' => 'createPlaylist', 'name' => 'Third', 'color' => '#d4a574']);
        $this->assertFalse($res['success']);
        $this->assertStringContainsString('playlists', $res['error']);

        $res = $this->save($user, ['action' => 'addBatch', 'newPlaylist' => 'Import', 'songs' => [$this->song('a')]]);
        $this->assertFalse($res['success']);
        $this->assertSame(2, $user->playlists()->count());
    }

    public function test_copying_a_shared_playlist_keeps_to_the_copiers_limits(): void
    {
        $owner = $this->user();
        $shared = $owner->playlists()->first();
        $shared->songs()->create(['position' => 0, 'title' => 'A', 'youtube_id' => 'aaaaaaaaaaa',
            'cover' => 'https://img.example/'.str_repeat('a', 2000)]);
        $shared->songs()->create(['position' => 1, 'title' => 'B', 'youtube_id' => 'bbbbbbbbbbb',
            'cover' => 'https://img.example/b.jpg']);
        $shared->songs()->create(['position' => 2, 'title' => 'C', 'youtube_id' => 'ccccccccccc']);

        $copier = $this->user();
        config(['library.songs' => 2]);

        $status = SharedPlaylistCopier::copy($copier, $shared);

        // Two songs fit, and it says so; the over-long cover did not come along
        $this->assertStringContainsString('the first 2 of its 3 songs', $status);
        $copy = $copier->playlists()->where('slug', '!=', 'mix')->firstOrFail();
        $this->assertSame(['', 'https://img.example/b.jpg'], $copy->songs()->orderBy('position')->pluck('cover')->all());

        // With the library full, and then with no playlist left, nothing is added
        $this->assertStringContainsString('No room', SharedPlaylistCopier::copy($copier, $shared));
        config(['library.songs' => 30000, 'library.playlists' => 2]);
        $this->assertStringContainsString('playlists', SharedPlaylistCopier::copy($copier, $shared));
        $this->assertSame(2, $copier->playlists()->count());
    }

    public function test_heavy_writes_are_rate_limited_and_say_so_in_the_pages_own_words(): void
    {
        $user = $this->user();

        for ($i = 0; $i < 90; $i++) {
            $this->actingAs($user)->post('/save-music', ['action' => 'share', 'playlist' => 'mix'])->assertOk();
        }

        // The player's own calls don't all ask for JSON; they get it anyway
        $res = $this->actingAs($user)->post('/save-music', ['action' => 'share', 'playlist' => 'mix']);
        $res->assertStatus(429)->assertJson(['success' => false, 'rateLimited' => true]);
        $this->assertStringContainsString('Wait a few seconds', $res->json('error'));

        // Listening, searching and adding songs one by one have their own,
        // roomier budget
        $this->actingAs($user)->post('/save-music', ['action' => 'searchLibrary', 'q' => 'so'])->assertOk();
        $this->assertTrue($this->save($user, ['action' => 'add', 'song' => $this->song('a')])['success']);
    }
}
