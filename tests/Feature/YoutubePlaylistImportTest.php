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

    public function test_names_the_import_after_the_playlist(): void
    {
        $html = $this->fakePlaylistHtml([['id' => 'aaaaaaaaaaa', 'title' => 'Laufey - From the Start']]);
        // Add the page's own title where YouTube keeps it.
        $html = str_replace('var ytInitialData = {', 'var ytInitialData = {"metadata":{"playlistMetadataRenderer":{"title":"Late Night Drive"}},', $html);
        Http::fake(['www.youtube.com/playlist*' => Http::response($html)]);

        $this->actingAs($this->user())
            ->postJson('/youtube-playlist', ['url' => 'https://www.youtube.com/playlist?list=PLtest123'])
            ->assertOk()
            ->assertJson(['success' => true, 'name' => 'Late Night Drive']);
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

    public function test_pages_through_playlists_longer_than_the_first_page(): void
    {
        $lockup = fn (int $i) => ['lockupViewModel' => [
            'contentId' => sprintf('vid%08d', $i),
            'contentType' => 'LOCKUP_CONTENT_TYPE_VIDEO',
            'metadata' => ['lockupMetadataViewModel' => ['title' => ['content' => "Artist - Song {$i}"]]],
        ]];
        $continuation = fn (string $token) => ['continuationItemViewModel' => [
            'continuationCommand' => ['innertubeCommand' => ['continuationCommand' => ['token' => $token]]],
        ]];

        // Page 1 (HTML): songs 0-99 + token. Page 2: 100-199 + token. Page 3: 200-229, end.
        $first = ['contents' => ['list' => [...array_map($lockup, range(0, 99)), $continuation('tok-2')]]];
        $html = '<script>ytcfg.set({"INNERTUBE_CLIENT_VERSION":"2.20990101.00.00"});var ytInitialData = '
            .json_encode($first).';</script>';

        Http::fake([
            'www.youtube.com/playlist*' => Http::response($html),
            'www.youtube.com/youtubei/v1/browse*' => function ($request) use ($lockup, $continuation) {
                $this->assertSame('2.20990101.00.00', $request['context']['client']['clientVersion']);
                $items = $request['continuation'] === 'tok-2'
                    ? [...array_map($lockup, range(100, 199)), $continuation('tok-3')]
                    : array_map($lockup, range(200, 229));

                return Http::response(['onResponseReceivedActions' => [
                    ['appendContinuationItemsAction' => ['continuationItems' => $items]],
                ]]);
            },
        ]);

        $res = $this->actingAs($this->user())
            ->postJson('/youtube-playlist', ['url' => 'https://music.youtube.com/playlist?list=PLlong123'])
            ->assertOk()
            ->assertJson(['success' => true, 'total' => 230, 'truncated' => false]);

        $this->assertSame('vid00000229', $res->json('songs.229.youtube_id'));
        $this->assertSame('Song 150', $res->json('songs.150.title'));
    }

    public function test_keeps_the_first_page_when_a_continuation_fails(): void
    {
        $data = ['contents' => ['list' => [
            ['lockupViewModel' => [
                'contentId' => 'aaaaaaaaaaa',
                'metadata' => ['lockupMetadataViewModel' => ['title' => ['content' => 'Band - Tune']]],
            ]],
            ['continuationItemViewModel' => ['continuationCommand' => ['token' => 'tok']]],
        ]]];

        Http::fake([
            'www.youtube.com/playlist*' => Http::response('<script>var ytInitialData = '.json_encode($data).';</script>'),
            'www.youtube.com/youtubei/v1/browse*' => Http::response('nope', 500),
        ]);

        $this->actingAs($this->user())
            ->postJson('/youtube-playlist', ['url' => 'https://www.youtube.com/playlist?list=PLbroken'])
            ->assertOk()
            // The rest of the playlist couldn't be loaded: say so, don't pass 1 song off as all of it.
            ->assertJson(['success' => true, 'total' => 1, 'truncated' => true]);
    }

    public function test_requires_authentication(): void
    {
        $this->postJson('/youtube-playlist', ['url' => 'x'])->assertRedirect();
    }
}
