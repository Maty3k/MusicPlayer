<?php

namespace Tests\Feature;

use App\Models\Playlist;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class LinkLocalCopyTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    private Playlist $playlist;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::forceCreate([
            'name' => 'Curator',
            'email' => 'curator@example.com',
            'password' => bcrypt('secret-password'),
            'email_verified_at' => now(),
        ]);
        $this->playlist = $this->user->playlists()->create([
            'slug' => 'favorites', 'name' => 'Favorites', 'position' => 0,
        ]);
        $this->user->update(['active_playlist_slug' => 'favorites']);
    }

    private function addYoutubeSong(string $title, string $artist, string $mp3 = ''): void
    {
        $this->playlist->songs()->create([
            'position' => $this->playlist->songs()->count(),
            'title' => $title,
            'artist' => $artist,
            'album' => '',
            'cover' => '',
            'youtube_id' => 'dQw4w9WgXcQ',
            'mp3_url' => $mp3,
            'spotify_id' => '',
        ]);
    }

    private function postAdd(array $song, bool $link = true)
    {
        return $this->actingAs($this->user)->postJson('/save-music', [
            'action' => 'add', 'song' => $song, 'link' => $link,
        ]);
    }

    public function test_matching_upload_links_instead_of_duplicating(): void
    {
        $this->addYoutubeSong('Blinding Lights', 'The Weeknd');

        $this->postAdd([
            'title' => 'Blinding Lights (Official Video)',
            'artist' => 'The Weeknd',
            'mp3_url' => '/media/11111111-1111-1111-1111-111111111111.mp3',
        ])->assertOk()->assertJson(['success' => true, 'linked' => true, 'index' => 0]);

        $this->assertSame(1, $this->playlist->songs()->count());
        $song = $this->playlist->songs()->first();
        $this->assertSame('/media/11111111-1111-1111-1111-111111111111.mp3', $song->mp3_url);
        $this->assertSame('dQw4w9WgXcQ', $song->youtube_id);
    }

    public function test_artist_matches_loosely_against_feat_credits(): void
    {
        $this->addYoutubeSong("Hips Don't Lie", 'Shakira ft. Wyclef Jean');

        $this->postAdd([
            'title' => "Hips Don't Lie",
            'artist' => 'Shakira',
            'mp3_url' => '/media/22222222-2222-2222-2222-222222222222.mp3',
        ])->assertOk()->assertJson(['success' => true, 'linked' => true]);

        $this->assertSame(1, $this->playlist->songs()->count());
    }

    public function test_non_matching_upload_adds_a_new_song(): void
    {
        $this->addYoutubeSong('Blinding Lights', 'The Weeknd');

        $res = $this->postAdd([
            'title' => 'Save Your Tears',
            'artist' => 'The Weeknd',
            'mp3_url' => '/media/33333333-3333-3333-3333-333333333333.mp3',
        ]);
        $res->assertOk()->assertJson(['success' => true, 'index' => 1]);
        $this->assertArrayNotHasKey('linked', $res->json());

        $this->assertSame(2, $this->playlist->songs()->count());
    }

    public function test_existing_local_copy_is_never_clobbered(): void
    {
        $this->addYoutubeSong('Blinding Lights', 'The Weeknd', '/media/44444444-4444-4444-4444-444444444444.mp3');

        $this->postAdd([
            'title' => 'Blinding Lights',
            'artist' => 'The Weeknd',
            'mp3_url' => '/media/55555555-5555-5555-5555-555555555555.mp3',
        ])->assertOk()->assertJson(['success' => true, 'index' => 1]);

        $this->assertSame(2, $this->playlist->songs()->count());
        $this->assertSame(
            '/media/44444444-4444-4444-4444-444444444444.mp3',
            $this->playlist->songs()->where('position', 0)->first()->mp3_url
        );
    }

    public function test_without_link_flag_behavior_is_unchanged(): void
    {
        $this->addYoutubeSong('Blinding Lights', 'The Weeknd');

        $this->postAdd([
            'title' => 'Blinding Lights',
            'artist' => 'The Weeknd',
            'mp3_url' => '/media/66666666-6666-6666-6666-666666666666.mp3',
        ], link: false)->assertOk()->assertJson(['success' => true, 'index' => 1]);

        $this->assertSame(2, $this->playlist->songs()->count());
    }
}
