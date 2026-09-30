<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class BatchImportTest extends TestCase
{
    use RefreshDatabase;

    private function userWithPlaylist(): User
    {
        $user = User::forceCreate([
            'name' => 'Importer',
            'email' => uniqid().'@example.com',
            'password' => bcrypt('secret-password'),
            'email_verified_at' => now(),
        ]);
        $user->playlists()->create([
            'slug' => 'faves', 'name' => 'Faves', 'color' => '#d4a574',
            'current_index' => 0, 'source' => 'user', 'position' => 0,
        ]);
        $user->forceFill(['active_playlist_slug' => 'faves'])->save();

        return $user;
    }

    public function test_batch_add_inserts_all_songs_at_contiguous_positions(): void
    {
        $user = $this->userWithPlaylist();

        $res = $this->actingAs($user)->postJson('/save-music', [
            'action' => 'addBatch',
            'songs' => [
                ['title' => 'One', 'artist' => 'A', 'youtube_id' => 'aaaaaaaaaaa'],
                ['title' => 'Two', 'artist' => 'B', 'youtube_id' => 'bbbbbbbbbbb'],
                ['title' => 'Three', 'artist' => 'C', 'youtube_id' => 'ccccccccccc'],
            ],
        ])->assertOk();

        $res->assertJson(['success' => true, 'added' => 3, 'skipped' => 0]);
        $songs = $user->playlists()->first()->songs()->orderBy('position')->get();
        $this->assertSame([0, 1, 2], $songs->pluck('position')->all());
        $this->assertSame(['One', 'Two', 'Three'], $songs->pluck('title')->all());
    }

    public function test_batch_add_skips_duplicates_by_youtube_id_and_title_artist(): void
    {
        $user = $this->userWithPlaylist();
        $playlist = $user->playlists()->first();
        $playlist->songs()->create([
            'position' => 0, 'title' => 'Existing', 'artist' => 'Band',
            'album' => '', 'cover' => '', 'youtube_id' => 'existing111', 'mp3_url' => '', 'spotify_id' => '',
        ]);

        $res = $this->actingAs($user)->postJson('/save-music', [
            'action' => 'addBatch',
            'songs' => [
                ['title' => 'Existing', 'artist' => 'Band', 'youtube_id' => 'differentXX'], // dupe by title|artist
                ['title' => 'Other Name', 'artist' => 'X', 'youtube_id' => 'existing111'],   // dupe by youtube_id
                ['title' => 'Fresh', 'artist' => 'New', 'youtube_id' => 'freshvideo1'],       // new
                ['title' => 'Fresh', 'artist' => 'New', 'youtube_id' => 'freshvideo1'],       // in-batch dupe
            ],
        ])->assertOk();

        $res->assertJson(['success' => true, 'added' => 1, 'skipped' => 3]);
        $this->assertSame(2, $playlist->songs()->count());
    }

    public function test_batch_add_rejects_oversized_batches(): void
    {
        $user = $this->userWithPlaylist();
        $songs = [];
        for ($i = 0; $i < 201; $i++) {
            $songs[] = ['title' => "T{$i}", 'artist' => 'A', 'youtube_id' => sprintf('v%010d', $i)];
        }

        $this->actingAs($user)->postJson('/save-music', ['action' => 'addBatch', 'songs' => $songs])
            ->assertOk()
            ->assertJson(['success' => false]);

        $this->assertSame(0, $user->playlists()->first()->songs()->count());
    }

    public function test_batch_add_can_create_a_new_playlist_named_after_the_source(): void
    {
        $user = $this->userWithPlaylist();
        $longName = str_repeat('Road Trip ', 12); // 120 chars: past the 30 a typed name gets

        $res = $this->actingAs($user)->postJson('/save-music', [
            'action' => 'addBatch',
            'newPlaylist' => $longName,
            'songs' => [
                ['title' => 'One', 'artist' => 'A', 'youtube_id' => 'aaaaaaaaaaa'],
                ['title' => 'Two', 'artist' => 'B', 'youtube_id' => 'bbbbbbbbbbb'],
            ],
        ])->assertOk();

        $res->assertJson(['success' => true, 'added' => 2]);
        $slug = $res->json('playlistId');
        $this->assertNotSame('faves', $slug);
        $new = $user->playlists()->where('slug', $slug)->first();
        $this->assertNotNull($new);
        $this->assertLessThanOrEqual(90, mb_strlen($new->name));
        $this->assertGreaterThan(30, mb_strlen($new->name));
        $this->assertStringStartsWith('Road Trip Road Trip', $new->name);
        $this->assertSame(2, $new->songs()->count());
        // The open playlist is untouched.
        $this->assertSame(0, $user->playlists()->where('slug', 'faves')->first()->songs()->count());
    }

    public function test_later_chunks_follow_the_new_playlist_by_id(): void
    {
        $user = $this->userWithPlaylist();
        $first = $this->actingAs($user)->postJson('/save-music', [
            'action' => 'addBatch',
            'newPlaylist' => 'Mixtape',
            'songs' => [['title' => 'One', 'artist' => 'A', 'youtube_id' => 'aaaaaaaaaaa']],
        ])->assertOk();
        $slug = $first->json('playlistId');

        $this->actingAs($user)->postJson('/save-music', [
            'action' => 'addBatch',
            'playlist' => $slug,
            'songs' => [['title' => 'Two', 'artist' => 'B', 'youtube_id' => 'bbbbbbbbbbb']],
        ])->assertOk()->assertJson(['success' => true, 'added' => 1, 'total' => 2, 'playlistId' => $slug]);

        $this->assertSame(1, $user->playlists()->where('name', 'Mixtape')->count());
    }

    public function test_batch_add_rejects_someone_elses_or_unknown_playlist(): void
    {
        $user = $this->userWithPlaylist();
        $other = $this->userWithPlaylist();

        $this->actingAs($user)->postJson('/save-music', [
            'action' => 'addBatch',
            'playlist' => 'faves-of-nobody',
            'songs' => [['title' => 'One', 'artist' => 'A', 'youtube_id' => 'aaaaaaaaaaa']],
        ])->assertOk()->assertJson(['success' => false]);

        // "faves" exists for both users; this user's request only reaches their own.
        $this->actingAs($user)->postJson('/save-music', [
            'action' => 'addBatch',
            'playlist' => 'faves',
            'songs' => [['title' => 'One', 'artist' => 'A', 'youtube_id' => 'aaaaaaaaaaa']],
        ])->assertOk()->assertJson(['success' => true]);
        $this->assertSame(0, $other->playlists()->first()->songs()->count());
    }

    public function test_a_blank_new_playlist_name_gets_a_default(): void
    {
        $user = $this->userWithPlaylist();
        $res = $this->actingAs($user)->postJson('/save-music', [
            'action' => 'addBatch',
            'newPlaylist' => "   \n  ",
            'songs' => [['title' => 'One', 'artist' => 'A', 'youtube_id' => 'aaaaaaaaaaa']],
        ])->assertOk()->assertJson(['success' => true]);

        $this->assertSame('Imported playlist', $user->playlists()->where('slug', $res->json('playlistId'))->value('name'));
    }

    public function test_one_oversized_or_malformed_song_does_not_fail_the_batch(): void
    {
        $user = $this->userWithPlaylist();

        $this->actingAs($user)->postJson('/save-music', [
            'action' => 'addBatch',
            'songs' => [
                ['title' => str_repeat('Very long title ', 40), 'artist' => str_repeat('A', 500),
                    'album' => str_repeat('B', 400), 'youtube_id' => 'aaaaaaaaaaa', 'spotify_id' => 'not-a-real-spotify-id'],
                ['title' => ['an', 'array'], 'artist' => 'X', 'youtube_id' => 'bbbbbbbbbbb'],
                ['title' => 'Fine', 'artist' => ['nested'], 'youtube_id' => ['also', 'bad']],
            ],
        ])->assertOk()->assertJson(['success' => true, 'added' => 2, 'skipped' => 1]);

        $songs = $user->playlists()->first()->songs()->orderBy('position')->get();
        $this->assertSame(300, mb_strlen($songs[0]->title));
        $this->assertSame(300, mb_strlen($songs[0]->artist));
        $this->assertSame('', $songs[0]->spotify_id);
        $this->assertSame('Fine', $songs[1]->title);
        $this->assertSame('', $songs[1]->artist);
        $this->assertSame('', $songs[1]->youtube_id);
    }

    public function test_adding_one_song_trims_over_long_fields(): void
    {
        $user = $this->userWithPlaylist();

        $this->actingAs($user)->postJson('/save-music', [
            'action' => 'add',
            'song' => ['title' => str_repeat('T', 350), 'artist' => str_repeat('A', 320), 'youtube_id' => 'aaaaaaaaaaa'],
        ])->assertOk()->assertJson(['success' => true]);

        $song = $user->playlists()->first()->songs()->first();
        $this->assertSame(300, mb_strlen($song->title));
        $this->assertSame(300, mb_strlen($song->artist));
    }

    public function test_batch_add_requires_authentication(): void
    {
        $this->postJson('/save-music', ['action' => 'addBatch', 'songs' => []])->assertRedirect();
    }
}
