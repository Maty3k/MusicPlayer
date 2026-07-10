<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * Serves a user's uploaded audio/cover files from private storage.
 * The directory is derived from the session user (music/{user_id}/…),
 * so a user can only ever fetch their own uploads — no path input from
 * the client reaches the filesystem beyond a uuid.ext filename.
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

    public function __invoke(Request $request, string $filename): BinaryFileResponse
    {
        // Uploads are stored as {uuid}.{ext} — anything else is a probe.
        abort_unless((bool) preg_match('/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.[a-z0-9]{1,5}$/', $filename), 404);

        $disk = Storage::disk('local');
        $path = 'music/'.$request->user()->id.'/'.$filename;
        abort_unless($disk->exists($path), 404);

        $ext = pathinfo($filename, PATHINFO_EXTENSION);

        // BinaryFileResponse handles HTTP Range requests, which <audio>
        // needs for seeking. Immutable: uuid filenames never change content.
        return new BinaryFileResponse($disk->path($path), 200, [
            'Content-Type' => self::MIMES[$ext] ?? 'application/octet-stream',
            'Cache-Control' => 'private, max-age=31536000, immutable',
            'Accept-Ranges' => 'bytes',
        ]);
    }
}
