<?php

namespace App\Support;

use GuzzleHttp\Exception\TransferException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * The friend's Cloudflare Worker in front of his private R2 "music" bucket,
 * behind Settings → Source → Cloudflare. It answers GET /list, GET /file/<key>
 * and PUT /upload/<key>, each authorised with ?t=<token>.
 *
 * That token is one secret shared by every account, so it never leaves the
 * server: the page only talks to /cloud-music/* (CloudMusicController), and
 * this class adds the token to each call. A URL built here carries the token,
 * so it is never logged, stored or put in an answer.
 */
class CloudMusic
{
    /** What the proxy plays, by extension, and the type it is served as. */
    public const TYPES = [
        'mp3' => 'audio/mpeg',
        'm4a' => 'audio/mp4',
        'mp4' => 'audio/mp4',
        'aac' => 'audio/aac',
        'wav' => 'audio/wav',
        'flac' => 'audio/flac',
        'ogg' => 'audio/ogg',
        'oga' => 'audio/ogg',
        'opus' => 'audio/ogg',
    ];

    /** What can be uploaded through the site (the friend's own choice). */
    public const UPLOAD_EXTENSIONS = ['mp3', 'm4a'];

    /** R2's own limit for a key. */
    private const MAX_KEY_BYTES = 1024;

    /**
     * Whether the source is set up: CLOUD_MUSIC_URL and CLOUD_MUSIC_TOKEN.
     * The token travels in the address, so the Worker must be https (plain
     * http only on this machine, for a stand-in while developing), and the
     * address may not carry a login of its own.
     */
    public static function configured(): bool
    {
        $parts = self::baseUrl() === '' ? false : parse_url(self::baseUrl());
        if ($parts === false || self::token() === '' || ! isset($parts['host']) || isset($parts['user']) || isset($parts['pass'])) {
            return false;
        }
        $scheme = strtolower($parts['scheme'] ?? '');

        return $scheme === 'https'
            || ($scheme === 'http' && in_array(strtolower($parts['host']), ['localhost', '127.0.0.1', '[::1]'], true));
    }

    /**
     * The type a file is served as, or null when the proxy doesn't serve it.
     * Never the Worker's own Content-Type: the answer comes from this site's
     * address, so a file in the bucket must not be able to arrive as a page.
     */
    public static function typeFor(string $key): ?string
    {
        return self::TYPES[strtolower(pathinfo($key, PATHINFO_EXTENSION))] ?? null;
    }

    /**
     * A key worth passing to the Worker: valid UTF-8 without control
     * characters, at most 1024 bytes, with a playable extension.
     */
    public static function isPlayableKey(string $key): bool
    {
        return $key !== ''
            && strlen($key) <= self::MAX_KEY_BYTES
            && mb_check_encoding($key, 'UTF-8')
            && ! preg_match('/[\x00-\x1F\x7F]/', $key)
            && self::typeFor($key) !== null;
    }

    /**
     * The key an uploaded file is stored under: its own name, as in the
     * friend's version, without folders or control characters. Null when
     * that leaves no usable MP3/M4A name.
     */
    public static function uploadKey(string $name): ?string
    {
        $name = basename(str_replace('\\', '/', $name));
        $name = (string) preg_replace('/[\x00-\x1F\x7F]/u', '', $name);
        $name = trim((string) preg_replace('/\s+/u', ' ', $name));

        $extension = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        if ($name === '' || str_starts_with($name, '.') || mb_strlen($name) > 200
            || ! in_array($extension, self::UPLOAD_EXTENSIONS, true) || ! self::isPlayableKey($name)) {
            return null;
        }

        return $name;
    }

    /**
     * Every playable file in the bucket, with what the page needs of it.
     *
     * @return list<array{key: string, size: int}>
     *
     * @throws CloudMusicUnavailable
     */
    public function list(): array
    {
        $response = $this->send(fn (PendingRequest $http) => $http
            ->timeout(15)
            ->acceptJson()
            ->get(self::baseUrl().'/list'));

        $data = $response->json();
        if (! is_array($data) || ! array_is_list($data)) {
            throw new CloudMusicUnavailable("The Cloudflare Worker's list couldn't be read.");
        }

        $songs = [];
        foreach ($data as $item) {
            $key = is_array($item) ? ($item['key'] ?? null) : null;
            $size = is_array($item) ? ($item['size'] ?? null) : null;
            // Size 0 is an upload that failed.
            if (is_string($key) && is_numeric($size) && (int) $size > 0 && self::isPlayableKey($key)) {
                $songs[] = ['key' => $key, 'size' => (int) $size];
            }
        }

        return $songs;
    }

    /**
     * One file from the bucket with the browser's Range passed along. The
     * body is a stream, read while it is sent on, never held in memory.
     * 404 and 416 come back to the caller; other errors throw.
     *
     * @throws CloudMusicUnavailable
     */
    public function file(string $key, ?string $range): Response
    {
        // Streamed through PHP's own stream handler, where the timeout is per
        // read (and the connect), not for the whole song.
        return $this->send(fn (PendingRequest $http) => $http
            ->withOptions(['stream' => true, 'decode_content' => false])
            ->withHeaders(array_filter(['Range' => $range, 'Accept-Encoding' => 'identity']))
            ->get(self::baseUrl().'/file/'.rawurlencode($key)),
            pass: [200, 206, 404, 416]);
    }

    /**
     * Store a file in the bucket under the given key.
     *
     * @param  resource  $body
     *
     * @throws CloudMusicUnavailable
     */
    public function upload(string $key, $body, string $type): void
    {
        $this->send(fn (PendingRequest $http) => $http
            ->timeout(120)
            ->withBody($body, $type)
            ->put(self::baseUrl().'/upload/'.rawurlencode($key)));
    }

    /**
     * Make one call to the Worker, with the token added here and only here.
     * Redirects aren't followed (the token would go along), and every failure
     * becomes a CloudMusicUnavailable whose message never contains the URL.
     *
     * @param  callable(PendingRequest): Response  $call
     * @param  list<int>  $pass  statuses handed back as they are; empty = any 2xx
     *
     * @throws CloudMusicUnavailable
     */
    private function send(callable $call, array $pass = []): Response
    {
        try {
            $response = $call(Http::connectTimeout(5)->withoutRedirecting()->withQueryParameters(['t' => self::token()]));
        } catch (ConnectionException|TransferException) {
            Log::warning("Cloudflare source: the Worker didn't answer");

            throw new CloudMusicUnavailable("The Cloudflare Worker didn't answer.", 504);
        }

        $status = $response->status();
        if ($pass === [] ? $response->successful() : in_array($status, $pass, true)) {
            return $response;
        }

        Log::warning("Cloudflare source: the Worker answered {$status}");

        throw new CloudMusicUnavailable(in_array($status, [401, 403], true)
            ? "The Cloudflare Worker refused this site's password (CLOUD_MUSIC_TOKEN)."
            : "The Cloudflare Worker answered with an error ({$status}).");
    }

    private static function baseUrl(): string
    {
        return rtrim((string) config('services.cloud_music.url'), '/');
    }

    private static function token(): string
    {
        return (string) config('services.cloud_music.token');
    }
}
