<?php

// A stand-in for the friend's Cloudflare Worker (see App\Support\CloudMusic)
// for tests/browser/suites/queue-check.js, which starts it like this:
//
//   CLOUD_MUSIC_TOKEN=… php -S 127.0.0.1:8787 tests/browser/fixtures/cloud-worker.php
//
//   GET /list         [{key, size}]: the songs below
//   GET /file/<key>   one song, always 206 with Content-Range, asked for a
//                     range or not (the friend's Worker answers that way);
//                     404 for a key it doesn't have
//
// Both check the token in ?t= against CLOUD_MUSIC_TOKEN. The songs are
// silent MP3s made here, so no audio file sits in the repository: MPEG-1
// Layer III frames with nothing in them, 30 seconds each (long enough that
// none ends by itself while a check runs).

const SONGS = 8;
const SECONDS = 30;

/** A silent MP3: 32 kbit/s mono frames of 104 bytes, all zeros after their header. */
function silentMp3(): string
{
    // FF FB: MPEG-1 Layer III without CRC; 10: 32 kbit/s at 44.1 kHz, no
    // padding; C0: mono. 144 * 32000 / 44100 = 104 bytes a frame.
    $frame = "\xFF\xFB\x10\xC0".str_repeat("\0", 100);

    return str_repeat($frame, (int) ceil(SECONDS * 44100 / 1152));
}

$keys = array_map(fn (int $i) => "Cloud $i - Tester.mp3", range(1, SONGS));
$token = (string) getenv('CLOUD_MUSIC_TOKEN');
$path = (string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);

if ($token === '' || ($_GET['t'] ?? '') !== $token) {
    http_response_code(401);
    echo 'Wrong token';

    return true;
}

if ($path === '/list') {
    $size = strlen(silentMp3());
    header('Content-Type: application/json');
    echo json_encode(array_map(fn (string $key) => ['key' => $key, 'size' => $size], $keys));

    return true;
}

if (str_starts_with($path, '/file/')) {
    if (! in_array(rawurldecode(substr($path, 6)), $keys, true)) {
        http_response_code(404);

        return true;
    }
    $body = silentMp3();
    $size = strlen($body);
    $start = 0;
    $end = $size - 1;
    if (preg_match('/\Abytes=(\d*)-(\d*)\z/', $_SERVER['HTTP_RANGE'] ?? '', $m)) {
        if ($m[1] !== '') {
            $start = (int) $m[1];
            if ($m[2] !== '') {
                $end = min((int) $m[2], $size - 1);
            }
        } elseif ($m[2] !== '') {
            $start = max(0, $size - (int) $m[2]); // the last N bytes
        }
    }
    if ($start > $end) {
        http_response_code(416);
        header("Content-Range: bytes */$size");

        return true;
    }
    http_response_code(206);
    header('Content-Type: application/octet-stream');
    header('Accept-Ranges: bytes');
    header("Content-Range: bytes $start-$end/$size");
    header('Content-Length: '.($end - $start + 1));
    echo substr($body, $start, $end - $start + 1);

    return true;
}

http_response_code(404);

return true;
