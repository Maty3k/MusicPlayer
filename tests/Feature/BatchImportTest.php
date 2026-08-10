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

    public function test_batch_add_requires_authentication(): void
    {
        $this->postJson('/save-music', ['action' => 'addBatch', 'songs' => []])->assertRedirect();
    }
}
