<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class UploadSongTest extends TestCase
{
    use RefreshDatabase;

    /** A real (minimal but valid) MP3 so mime sniffing sees audio/mpeg. */
    private function makeMp3(): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'mp3');
        // ID3v2 header + MPEG-1 Layer III frames (44.1kHz / 128kbps)
        $frame = "\xFF\xFB\x90\x00".str_repeat("\x00", 413);
        file_put_contents($path, "ID3\x03\x00\x00\x00\x00\x00\x00".str_repeat($frame, 40));

        return new UploadedFile($path, 'My Song.mp3', 'audio/mpeg', null, true);
    }

    /** A real (1×1) PNG so mime sniffing sees image/png. */
    private function makePng(): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'png');
        file_put_contents($path, base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='));

        return new UploadedFile($path, 'cover.png', 'image/png', null, true);
    }

    private function verifiedUser(): User
    {
        return User::forceCreate([
            'name' => 'Uploader',
            'email' => uniqid().'@example.com',
            'password' => bcrypt('secret-password'),
            'email_verified_at' => now(),
        ]);
    }

    public function test_upload_store_serve_and_orphan_cleanup(): void
    {
        Storage::fake('local');
        $user = $this->verifiedUser();

        // ---- Upload ----
        $res = $this->actingAs($user)->post('/upload-song', ['audio' => $this->makeMp3()]);
        $res->assertOk()->assertJson(['success' => true]);
        $url = $res->json('mp3_url');
        $this->assertMatchesRegularExpression('#^/media/[0-9a-f-]{36}\.mp3$#', $url);

        $filename = basename($url);
        Storage::disk('local')->assertExists("music/{$user->id}/{$filename}");

        // ---- Serve back with correct type; Range respected ----
        $this->actingAs($user)->get($url)
            ->assertOk()->assertHeader('Content-Type', 'audio/mpeg');

        $partial = $this->actingAs($user)->get($url, ['Range' => 'bytes=0-99']);
        $this->assertSame(206, $partial->getStatusCode());

        // ---- Another user cannot fetch it ----
        $other = $this->verifiedUser();
        $this->actingAs($other)->get($url)->assertNotFound();

        // ---- Add as a song, then delete: file is cleaned up ----
        $this->actingAs($user)->postJson('/save-music', [
            'action' => 'add',
            'song' => ['title' => 'My Song', 'artist' => 'Me', 'mp3_url' => $url],
        ])->assertJson(['success' => true]);

        $this->actingAs($user)->postJson('/save-music', [
            'action' => 'delete', 'index' => 0,
        ])->assertJson(['success' => true]);

        Storage::disk('local')->assertMissing("music/{$user->id}/{$filename}");
    }

    public function test_a_cover_image_is_stored_with_the_song(): void
    {
        Storage::fake('local');
        $user = $this->verifiedUser();

        $res = $this->actingAs($user)->post('/upload-song', ['audio' => $this->makeMp3(), 'cover' => $this->makePng()]);

        $res->assertOk()->assertJson(['success' => true]);
        $this->assertMatchesRegularExpression('#^/media/[0-9a-f-]{36}\.png$#', $res->json('cover'));
        Storage::disk('local')->assertExists("music/{$user->id}/".basename($res->json('cover')));
    }

    public function test_an_empty_field_named_cover_cannot_slip_an_unchecked_file_past_validation(): void
    {
        Storage::fake('local');
        $user = $this->verifiedUser();
        $page = UploadedFile::fake()->createWithContent('page.html', '<script>alert(1)</script>'.str_repeat(' ', 3 * 1024 * 1024));

        // A hand-made request: an empty text part and a file part, both named cover.
        $res = $this->actingAs($user)->call('POST', '/upload-song', ['cover' => ''], [], ['audio' => $this->makeMp3(), 'cover' => $page]);

        $res->assertOk()->assertJson(['success' => true, 'cover' => '']);
        $this->assertCount(1, Storage::disk('local')->files("music/{$user->id}"));
    }

    public function test_rejects_non_audio_and_traversal_probes(): void
    {
        Storage::fake('local');
        $user = $this->verifiedUser();

        // Not an audio file
        $bad = UploadedFile::fake()->create('evil.php', 10, 'text/x-php');
        $this->actingAs($user)->post('/upload-song', ['audio' => $bad])
            ->assertSessionHasErrors('audio');

        // Media route only serves uuid.ext names
        $this->actingAs($user)->get('/media/..%2F..%2F.env')->assertNotFound();
        $this->actingAs($user)->get('/media/notauuid.mp3')->assertNotFound();
    }

    public function test_media_requires_authentication(): void
    {
        $this->get('/media/00000000-0000-0000-0000-000000000000.mp3')
            ->assertRedirect('/login');
    }

    public function test_bucket_mode_streams_downloads_and_redirects_playback(): void
    {
        config(['filesystems.uploads' => 's3']);
        Storage::fake('s3');
        $user = $this->verifiedUser();

        $res = $this->actingAs($user)->post('/upload-song', ['audio' => $this->makeMp3()]);
        $res->assertOk()->assertJson(['success' => true]);
        $url = $res->json('mp3_url');
        Storage::disk('s3')->assertExists("music/{$user->id}/".basename($url));

        // Offline download (?dl=1) must be a same-origin stream, never a redirect
        $this->actingAs($user)->get($url.'?dl=1')
            ->assertOk()->assertHeader('Content-Type', 'audio/mpeg');

        // Disk with signed URLs: playback redirects to them
        Storage::disk('s3')->buildTemporaryUrlsUsing(fn () => 'https://bucket.test/signed-song');
        $this->actingAs($user)->get($url)->assertRedirect('https://bucket.test/signed-song');

        // Deleting the song still garbage-collects from the bucket
        $this->actingAs($user)->postJson('/save-music', [
            'action' => 'add',
            'song' => ['title' => 'Bucket Song', 'mp3_url' => $url],
        ])->assertJson(['success' => true]);
        $this->actingAs($user)->postJson('/save-music', ['action' => 'delete', 'index' => 0])
            ->assertJson(['success' => true]);
        Storage::disk('s3')->assertMissing("music/{$user->id}/".basename($url));
    }
}
