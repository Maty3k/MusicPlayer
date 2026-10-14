<?php

namespace App\Http\Controllers;

use App\Support\CloudMusic;
use App\Support\CloudMusicUnavailable;
use Generator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * The Cloudflare source (Settings → Source): the page's only way to the
 * friend's Worker. App\Support\CloudMusic adds the Worker's token on the
 * server, so it never reaches a browser, the service worker's copy of the
 * page, or a song's address.
 *
 *  - GET  /cloud-music/list          the playable files, as JSON
 *  - GET  /cloud-music/file?key=…    one file, streamed, with Range for
 *                                    seeking (iPhones need 206 answers). It is
 *                                    a song's mp3_url, so it never changes.
 *  - POST /cloud-music/upload        one MP3 or M4A into the bucket, never
 *                                    over a file that is already there
 */
class CloudMusicController extends Controller
{
    public function __construct(private readonly CloudMusic $cloudMusic) {}

    public function list(): JsonResponse
    {
        abort_unless(CloudMusic::configured(), 404);

        try {
            return response()->json(['success' => true, 'songs' => $this->cloudMusic->list()]);
        } catch (CloudMusicUnavailable $e) {
            return response()->json(['success' => false, 'error' => $e->getMessage()], $e->status);
        }
    }

    public function file(Request $request): Response
    {
        abort_unless(CloudMusic::configured(), 404);

        $key = $request->query('key');
        abort_unless(is_string($key) && CloudMusic::isPlayableKey($key), 404);

        // One range, the way <audio> asks; anything else gets the whole file.
        $range = $request->header('Range');
        if (! is_string($range) || ! preg_match('/\Abytes=(\d+-\d*|-\d+)\z/', $range)) {
            $range = null;
        }

        try {
            $upstream = $this->cloudMusic->file($key, $range);
        } catch (CloudMusicUnavailable $e) {
            abort($e->status);
        }

        if ($upstream->status() === 404) {
            abort(404);
        }
        if ($upstream->status() === 416) {
            return response('', 416, array_filter(['Content-Range' => $upstream->header('Content-Range')]));
        }

        $headers = [
            'Content-Type' => CloudMusic::typeFor($key),
            'Accept-Ranges' => 'bytes',
            'Cache-Control' => 'private, max-age=86400',
            // Opened on its own it is a file, never a page that runs anything
            'Content-Security-Policy' => 'sandbox',
        ];
        foreach (['Content-Length', 'Content-Range', 'ETag', 'Last-Modified'] as $name) {
            if ($upstream->header($name) !== '') {
                $headers[$name] = $upstream->header($name);
            }
        }

        $body = $upstream->toPsrResponse()->getBody();

        return response()->stream(function () use ($body): Generator {
            // The Worker breaking off mid-song happens after the answer has
            // started, outside any try above, and the error's message could
            // carry the Worker's address: stop quietly. <audio> asks again
            // from where it got to.
            try {
                while (! $body->eof()) {
                    $chunk = $body->read(64 * 1024);
                    if ($chunk === '') {
                        break;
                    }
                    yield $chunk;
                }
            } catch (Throwable) {
                Log::warning('Cloudflare source: a file broke off while streaming');
            } finally {
                $body->close();
            }
        }, $upstream->status(), $headers);
    }

    public function upload(Request $request): JsonResponse
    {
        abort_unless(CloudMusic::configured(), 404);

        $request->validate([
            // ~40 MB, the same as your own uploads (UploadSongController).
            'file' => ['required', 'file', 'max:40960', 'extensions:mp3,m4a', 'mimes:mp3,mpga,m4a,mp4'],
        ]);

        $file = $request->file('file');
        $key = CloudMusic::uploadKey($file->getClientOriginalName());
        if ($key === null) {
            return response()->json([
                'success' => false,
                'error' => "That file name can't be used. Give it a shorter name ending in .mp3 or .m4a.",
            ], 422);
        }

        try {
            if (in_array($key, array_column($this->cloudMusic->list(), 'key'), true)) {
                return response()->json(['success' => false, 'exists' => true, 'error' => 'Already in the bucket.'], 409);
            }

            $this->cloudMusic->upload($key, fopen($file->getRealPath(), 'rb'), (string) CloudMusic::typeFor($key));
        } catch (CloudMusicUnavailable $e) {
            return response()->json(['success' => false, 'error' => $e->getMessage()], $e->status);
        }

        return response()->json(['success' => true, 'key' => $key]);
    }
}
