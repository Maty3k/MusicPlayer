<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Stores a user-owned audio file (plus optional embedded cover art) in
 * private per-user storage. Returns root-relative /media/ URLs that the
 * frontend saves onto the song row — MediaController serves them back.
 *
 * Files live on the configured uploads disk (config filesystems.uploads)
 * at music/{user_id}/{uuid}.{ext}. Locally that's the 'local' disk; in
 * production attach a bucket/S3 (Laravel Cloud injects FILESYSTEM_DISK=s3)
 * so uploads survive the ephemeral container filesystem.
 */
class UploadSongController extends Controller
{
    /** Per-user storage budget for uploads, in bytes (500 MB). */
    private const QUOTA_BYTES = 500 * 1024 * 1024;

    public function __invoke(Request $request): JsonResponse
    {
        // Store what was validated, not whatever the request holds under the
        // same name: since Laravel 13.38 an empty text field called 'cover'
        // hides a file called 'cover' from validation, while file() and
        // hasFile() still return that file.
        $validated = $request->validate([
            // ~40 MB max — a full album-length FLAC won't fit, normal songs will.
            'audio' => ['required', 'file', 'max:40960', 'mimes:mp3,mpga,m4a,mp4,aac,ogg,oga,opus,wav,flac,webm'],
            'cover' => ['nullable', 'file', 'max:2048', 'mimes:jpg,jpeg,png,webp,gif'],
        ]);
        $audio = $validated['audio'];
        $cover = $validated['cover'] ?? null;

        $diskName = (string) config('filesystems.uploads', 'local');
        $disk = Storage::disk($diskName);
        $dir = 'music/'.$request->user()->id;

        $used = array_sum(array_map(fn ($f) => $disk->size($f), $disk->files($dir)));
        if ($used + $audio->getSize() > self::QUOTA_BYTES) {
            return response()->json([
                'success' => false,
                'error' => 'Storage limit reached (500 MB). Delete some uploaded songs first.',
            ], 422);
        }

        $audioName = (string) Str::uuid().'.'.$audio->extension();
        $audio->storeAs($dir, $audioName, $diskName);

        $coverUrl = '';
        if ($cover instanceof UploadedFile) {
            $coverName = (string) Str::uuid().'.'.$cover->extension();
            $cover->storeAs($dir, $coverName, $diskName);
            $coverUrl = '/media/'.$coverName;
        }

        return response()->json([
            'success' => true,
            'mp3_url' => '/media/'.$audioName,
            'cover' => $coverUrl,
        ]);
    }
}
