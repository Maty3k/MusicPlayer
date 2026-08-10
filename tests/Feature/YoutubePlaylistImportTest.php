<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class YoutubePlaylistImportTest extends TestCase
{
    use RefreshDatabase;

    private function user(): User
    {
        return User::forceCreate([
            'name' => 'Importer',
            'email' => uniqid().'@example.com',
            'password' => bcrypt('secret-password'),
            'email_verified_at' => now(),
        ]);
    }

    private function fakePlaylistHtml(array $videos): string
    {
        $items = array_map(fn ($v) => [
            'playlistVideoRenderer' => [
                'videoId' => $v['id'],
                'title' => ['runs' => [['text' => $v['title']]]],
                'shortBylineText' => ['runs' => [['text' => $v['channel'] ?? 'Some Channel']]],
            ],
        ], $videos);

        $data = ['contents' => ['x' => ['playlistVideoListRenderer' => ['contents' => $items]]]];

        return '<html><script>var ytInitialData = '.json_encode($data).';</script></html>';
    }

    public function test_imports_a_public_playlist_and_splits_titles(): void
    {
        Http::fake([
            'www.youtube.com/playlist*' => Http::response($this->fakePlaylistHtml([
                ['id' => 'aaaaaaaaaaa', 'title' => 'Laufey - From the Start (Official Video)'],
                ['id' => 'bbbbbbbbbbb', 'title' => 'Just A Title', 'channel' => 'Cool Band - Topic'],
            ])),
        ]);

        $res = $this->actingAs($this->user())
            ->postJson('/youtube-playlist', ['url' => 'https://www.youtube.com/playlist?list=PLtest123'])
            ->assertOk()
            ->assertJson(['success' => true, 'total' => 2]);

        $songs = $res->json('songs');
        // "Artist - Title" split, junk suffix trimmed.
        $this->assertSame('Laufey', $songs[0]['artist']);
        $this->assertSame('From the Start', $songs[0]['title']);
        $this->assertSame('aaaaaaaaaaa', $songs[0]['youtube_id']);
        // No dash → channel is the artist, "- Topic" stripped.
        $this->assertSame('Cool Band', $songs[1]['artist']);
        $this->assertSame('Just A Title', $songs[1]['title']);
    }

    public function test_rejects_a_non_playlist_url(): void
    {
        $this->actingAs($this->user())
            ->postJson('/youtube-playlist', ['url' => 'https://example.com/not-youtube'])
            ->assertOk()
            ->assertJson(['success' => false]);
    }

    public function test_reports_when_no_videos_found(): void
    {
        Http::fake(['www.youtube.com/playlist*' => Http::response('<html>no data here</html>')]);

        $this->actingAs($this->user())
            ->postJson('/youtube-playlist', ['url' => 'https://youtube.com/playlist?list=PLempty'])
            ->assertOk()
            ->assertJson(['success' => false]);
    }

    public function test_requires_authentication(): void
    {
        $this->postJson('/youtube-playlist', ['url' => 'x'])->assertRedirect();
    }
}
