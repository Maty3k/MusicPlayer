<?php

namespace Tests\Feature;

use App\Models\User;
use GuzzleHttp\Promise\Create;
use GuzzleHttp\Psr7\FnStream;
use GuzzleHttp\Psr7\Response as Psr7Response;
use GuzzleHttp\Psr7\Utils;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as WorkerRequest;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;
use Tests\TestCase;

// /cloud-music/*: the page's only way to the friend's Worker. The token is
// added on the server and never comes back to the browser.
class CloudMusicProxyTest extends TestCase
{
    use RefreshDatabase;

    private const WORKER = 'https://music.example.workers.dev';

    private const TOKEN = 's3cret-token';

    protected function setUp(): void
    {
        parent::setUp();

        config(['services.cloud_music.url' => self::WORKER, 'services.cloud_music.token' => self::TOKEN]);
        Http::preventStrayRequests();
    }

    /** A real (minimal but valid) MP3, so mime sniffing sees audio/mpeg. */
    private function mp3(string $name): UploadedFile
    {
        $frame = "\xFF\xFB\x90\x00".str_repeat("\x00", 413);

        return $this->upload($name, "ID3\x03\x00\x00\x00\x00\x00\x00".str_repeat($frame, 40));
    }

    /** A real file, not UploadedFile::fake(): a fake reports its type from its name. */
    private function upload(string $name, string $content): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'upl');
        file_put_contents($path, $content);

        return new UploadedFile($path, $name, 'audio/mpeg', null, true);
    }

    public function test_the_list_comes_from_the_worker_with_the_token_added_on_the_server(): void
    {
        Http::fake([self::WORKER.'/list*' => Http::response([
            ['key' => 'ABBA - Waterloo - AbbaVEVO.mp3', 'size' => 4000000, 'uploaded' => '2026-10-01T10:00:00Z'],
            ['key' => 'Failed upload.mp3', 'size' => 0],
            ['key' => 'notes.txt', 'size' => 12],
            ['key' => 'page.html', 'size' => 1200],
            ['key' => "two\nlines.mp3", 'size' => 10],
            ['size' => 10],
            'just a string',
            ['key' => 'Folder/Track.m4a', 'size' => '2500'],
        ])]);

        $response = $this->actingAs(User::factory()->create())->getJson('/cloud-music/list');

        $response->assertOk()->assertExactJson(['success' => true, 'songs' => [
            ['key' => 'ABBA - Waterloo - AbbaVEVO.mp3', 'size' => 4000000],
            ['key' => 'Folder/Track.m4a', 'size' => 2500],
        ]]);
        $this->assertStringNotContainsString(self::TOKEN, $response->getContent());
        Http::assertSent(fn (WorkerRequest $request) => $request->url() === self::WORKER.'/list?t='.self::TOKEN);
    }

    public function test_a_refused_token_reads_as_a_worker_problem_not_as_a_signed_out_session(): void
    {
        Http::fake([self::WORKER.'/*' => Http::response('Unauthorized: bad token', 401)]);

        $response = $this->actingAs(User::factory()->create())->getJson('/cloud-music/list');

        $response->assertStatus(502)
            ->assertExactJson(['success' => false, 'error' => "The Cloudflare Worker refused this site's password (CLOUD_MUSIC_TOKEN)."]);
        $this->assertStringNotContainsString('bad token', $response->getContent());
    }

    public function test_a_worker_that_does_not_answer_gives_a_short_message_without_its_address(): void
    {
        Http::fake([self::WORKER.'/*' => Http::failedConnection()]);

        $response = $this->actingAs(User::factory()->create())->getJson('/cloud-music/list');

        $response->assertStatus(504)->assertExactJson(['success' => false, 'error' => "The Cloudflare Worker didn't answer."]);
        $this->assertStringNotContainsString('workers.dev', $response->getContent());
    }

    public function test_a_list_that_is_not_a_list_is_refused(): void
    {
        Http::fake([self::WORKER.'/list*' => Http::response(['error' => 'nope'])]);

        $this->actingAs(User::factory()->create())->getJson('/cloud-music/list')
            ->assertStatus(502)->assertJson(['success' => false]);
    }

    public function test_a_redirect_from_the_worker_is_not_followed(): void
    {
        Http::fake([self::WORKER.'/list*' => Http::response('', 302, ['Location' => 'https://elsewhere.example/collect'])]);

        $this->actingAs(User::factory()->create())->getJson('/cloud-music/list')->assertStatus(502);
        Http::assertSentCount(1);
    }

    public function test_a_file_streams_through_with_its_range_and_an_audio_type(): void
    {
        Http::fake([self::WORKER.'/file/*' => Http::response('abcdefghij', 206, [
            // The Worker's own type is never passed on: the answer comes from this site.
            'Content-Type' => 'text/html',
            'Content-Range' => 'bytes 0-9/4000000',
            'Content-Length' => '10',
            'ETag' => '"abc"',
            'Set-Cookie' => 'worker=1',
        ])]);
        $key = 'Folder/Ünïcödé # Hash ? & + %.mp3';

        $response = $this->actingAs(User::factory()->create())
            ->get('/cloud-music/file?key='.rawurlencode($key), ['Range' => 'bytes=0-9']);

        $response->assertStatus(206)
            ->assertHeader('Content-Type', 'audio/mpeg')
            ->assertHeader('Content-Range', 'bytes 0-9/4000000')
            ->assertHeader('Content-Length', '10')
            ->assertHeader('Accept-Ranges', 'bytes')
            ->assertHeader('X-Content-Type-Options', 'nosniff')
            ->assertCookieMissing('worker');
        $this->assertSame('abcdefghij', $response->streamedContent());
        Http::assertSent(fn (WorkerRequest $request) => $request->url() === self::WORKER.'/file/'.rawurlencode($key).'?t='.self::TOKEN
            && $request->hasHeader('Range', 'bytes=0-9'));
    }

    public function test_an_odd_range_is_not_passed_on(): void
    {
        Http::fake([self::WORKER.'/file/*' => Http::response('whole file', 200, ['Content-Length' => '10'])]);

        $response = $this->actingAs(User::factory()->create())
            ->get('/cloud-music/file?key=song.m4a', ['Range' => 'bytes=0-1,5-9']);

        $response->assertOk()->assertHeader('Content-Type', 'audio/mp4');
        $this->assertSame('whole file', $response->streamedContent());
        Http::assertSent(fn (WorkerRequest $request) => ! $request->hasHeader('Range'));
    }

    public function test_only_audio_keys_are_passed_on_so_a_bucket_file_cannot_arrive_as_a_page(): void
    {
        Http::fake();
        $user = User::factory()->create();

        foreach (['page.html', 'script.js', 'no-extension', "two\nlines.mp3", str_repeat('a', 1100).'.mp3'] as $key) {
            $this->actingAs($user)->get('/cloud-music/file?key='.rawurlencode($key))->assertNotFound();
        }
        $this->actingAs($user)->get('/cloud-music/file')->assertNotFound();
        $this->actingAs($user)->get('/cloud-music/file?key[]=song.mp3')->assertNotFound();
        Http::assertNothingSent();
    }

    public function test_worker_errors_on_a_file_become_plain_statuses(): void
    {
        Http::fake([
            self::WORKER.'/file/gone.mp3*' => Http::response('Not found', 404),
            self::WORKER.'/file/past-the-end.mp3*' => Http::response('', 416, ['Content-Range' => 'bytes */100']),
            self::WORKER.'/file/refused.mp3*' => Http::response('Unauthorized', 401),
        ]);
        $user = User::factory()->create();

        $this->actingAs($user)->get('/cloud-music/file?key=gone.mp3')->assertNotFound();
        $this->actingAs($user)->get('/cloud-music/file?key=past-the-end.mp3', ['Range' => 'bytes=500-'])
            ->assertStatus(416)->assertHeader('Content-Range', 'bytes */100');
        $this->actingAs($user)->get('/cloud-music/file?key=refused.mp3')->assertStatus(502);
    }

    public function test_an_upload_goes_to_the_worker_under_its_own_name_unless_it_is_already_there(): void
    {
        Http::fake([
            self::WORKER.'/list*' => Http::response([['key' => 'Already Here.mp3', 'size' => 100]]),
            self::WORKER.'/upload/*' => Http::response(['ok' => true]),
        ]);
        $user = User::factory()->create();

        $this->actingAs($user)->postJson('/cloud-music/upload', ['file' => $this->mp3('My Song.mp3')])
            ->assertOk()->assertExactJson(['success' => true, 'key' => 'My Song.mp3']);
        Http::assertSent(fn (WorkerRequest $request) => $request->method() === 'PUT'
            && $request->url() === self::WORKER.'/upload/My%20Song.mp3?t='.self::TOKEN
            && $request->hasHeader('Content-Type', 'audio/mpeg')
            && strlen($request->body()) > 1000);

        $this->actingAs($user)->postJson('/cloud-music/upload', ['file' => $this->mp3('Already Here.mp3')])
            ->assertStatus(409)->assertJson(['success' => false, 'exists' => true]);
        // list + upload, then only the list: nothing was written over
        Http::assertSentCount(3);
    }

    public function test_an_upload_must_be_an_mp3_or_m4a(): void
    {
        Http::fake();
        $user = User::factory()->create();

        $this->actingAs($user)->postJson('/cloud-music/upload', ['file' => $this->upload('song.mp3', '<html><script>alert(1)</script></html>')])
            ->assertStatus(422)->assertJsonValidationErrors('file');
        $this->actingAs($user)->postJson('/cloud-music/upload', ['file' => $this->mp3('song.wav')])
            ->assertStatus(422)->assertJsonValidationErrors('file');
        $this->actingAs($user)->postJson('/cloud-music/upload', [])
            ->assertStatus(422)->assertJsonValidationErrors('file');
        Http::assertNothingSent();
    }

    public function test_guests_get_nothing(): void
    {
        Http::fake();

        $this->getJson('/cloud-music/list')->assertUnauthorized();
        $this->get('/cloud-music/file?key=song.mp3')->assertUnauthorized();
        $this->postJson('/cloud-music/upload', ['file' => $this->mp3('song.mp3')])->assertUnauthorized();
        Http::assertNothingSent();
    }

    public function test_an_unverified_email_account_gets_nothing(): void
    {
        Http::fake();

        $this->actingAs(User::factory()->unverified()->create())->getJson('/cloud-music/list')->assertForbidden();
        Http::assertNothingSent();
    }

    public function test_without_both_settings_the_routes_do_not_exist(): void
    {
        Http::fake();
        $user = User::factory()->create();

        $notSetUp = [
            ['', ''],
            [self::WORKER, ''],
            ['', self::TOKEN],
            // the token would cross the internet in the clear
            ['http://music.example.workers.dev', self::TOKEN],
            // an address with a login of its own
            ['https://user:pass@music.example.workers.dev', self::TOKEN],
            ['not a url', self::TOKEN],
        ];
        foreach ($notSetUp as [$url, $token]) {
            config(['services.cloud_music.url' => $url, 'services.cloud_music.token' => $token]);

            $this->actingAs($user)->getJson('/cloud-music/list')->assertNotFound();
            $this->actingAs($user)->get('/cloud-music/file?key=song.mp3')->assertNotFound();
            $this->actingAs($user)->postJson('/cloud-music/upload', ['file' => $this->mp3('song.mp3')])->assertNotFound();
        }
        Http::assertNothingSent();
    }

    public function test_a_stand_in_worker_on_this_machine_may_use_plain_http(): void
    {
        config(['services.cloud_music.url' => 'http://127.0.0.1:8787']);
        Http::fake(['http://127.0.0.1:8787/list*' => Http::response([])]);

        $this->actingAs(User::factory()->create())->getJson('/cloud-music/list')->assertOk();
    }

    public function test_a_file_that_breaks_off_mid_way_ends_quietly_without_the_workers_address(): void
    {
        // The first read gives some bytes, the next one finds the connection gone
        $reads = 0;
        $inner = Utils::streamFor('first bytes');
        $body = FnStream::decorate($inner, [
            'eof' => fn () => false,
            'read' => function (int $length) use ($inner, &$reads) {
                if ($reads++ === 0) {
                    return $inner->read($length);
                }

                throw new RuntimeException('Connection reset for URI '.self::WORKER.'/file/song.mp3?t='.self::TOKEN);
            },
        ]);
        Http::fake([self::WORKER.'/file/*' => fn () => Create::promiseFor(new Psr7Response(200, ['Content-Length' => '100'], $body))]);
        Log::spy();

        $response = $this->actingAs(User::factory()->create())->get('/cloud-music/file?key=song.mp3');

        $response->assertOk()->assertHeader('Content-Security-Policy', 'sandbox');
        $this->assertSame('first bytes', $response->streamedContent());
        Log::shouldHaveReceived('warning')->once()->with('Cloudflare source: a file broke off while streaming');
    }

    public function test_the_list_has_a_named_rate_limit_that_answers_in_the_pages_shape(): void
    {
        Http::fake([self::WORKER.'/list*' => Http::response([])]);
        $user = User::factory()->create();

        for ($i = 0; $i < 30; $i++) {
            $this->actingAs($user)->getJson('/cloud-music/list')->assertOk();
        }

        $this->actingAs($user)->getJson('/cloud-music/list')
            ->assertStatus(429)->assertJson(['success' => false, 'rateLimited' => true]);
    }
}
