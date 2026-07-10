<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Serves a user's uploaded audio/cover files from the configured uploads
 * disk. The directory is derived from the session user (music/{user_id}/…),
 * so a user can only ever fetch their own uploads — no path input from
 * the client reaches the filesystem beyond a uuid.ext filename.
 *
 * Serving strategy depends on the disk:
 *  - local driver          → BinaryFileResponse (native HTTP Range support,
 *                            which <audio> needs for seeking)
 *  - bucket/S3, playback   → 302 to a short-lived signed URL; the bucket
 *                            handles Range itself
 *  - bucket/S3 with ?dl=1  → full-file stream through the app. The offline
 *                            downloader needs a same-origin 200 it can put
 *                            in the Cache API — a cross-origin redirect
 *                            target can't be cached usefully.
 */
class MediaController extends Controller
{
    private const MIMES = [
        'mp3' => 'audio/mpeg', 'mpga' => 'audio/mpeg',
        'm4a' => 'audio/mp4', 'mp4' => 'audio/mp4', 'aac' => 'audio/aac',
        'ogg' => 'audio/ogg', 'oga' => 'audio/ogg', 'opus' => 'audio/ogg',
        'wav' => 'audio/wav', 'flac' => 'audio/flac', 'webm' => 'audio/webm',
        'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png',
        'webp' => 'image/webp', 'gif' => 'image/gif',
    ];

    public function __invoke(Request $request, string $filename): Response
    {
        // Uploads are stored as {uuid}.{ext} — anything else is a probe.
        abort_unless((bool) preg_match('/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.[a-z0-9]{1,5}$/', $filename), 404);

        $diskName = (string) config('filesystems.uploads', 'local');
        $disk = Storage::disk($diskName);
        $path = 'music/'.$request->user()->id.'/'.$filename;
        abort_unless($disk->exists($path), 404);

        $ext = pathinfo($filename, PATHINFO_EXTENSION);
        $mime = self::MIMES[$ext] ?? 'application/octet-stream';

        if (config("filesystems.disks.{$diskName}.driver") === 'local') {
            // Immutable: uuid filenames never change content.
            return new BinaryFileResponse($disk->path($path), 200, [
                'Content-Type' => $mime,
                'Cache-Control' => 'private, max-age=31536000, immutable',
                'Accept-Ranges' => 'bytes',
            ]);
        }

        if (! $request->boolean('dl') && $disk->providesTemporaryUrls()) {
            return redirect()->away($disk->temporaryUrl($path, now()->addMinutes(30)));
        }

        // Same-origin full-file proxy (offline downloads, or disks without
        // signed URLs). No Range support — the service worker slices ranges
        // out of the cached copy itself.
        return new StreamedResponse(function () use ($disk, $path) {
            $stream = $disk->readStream($path);
            if ($stream !== null) {
                fpassthru($stream);
                fclose($stream);
            }
        }, 200, [
            'Content-Type' => $mime,
            'Content-Length' => (string) $disk->size($path),
            'Cache-Control' => 'private, max-age=31536000, immutable',
        ]);
    }
}
