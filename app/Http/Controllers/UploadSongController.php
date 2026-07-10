<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Stores a user-owned audio file (plus optional embedded cover art) in
 * private per-user storage. Returns root-relative /media/ URLs that the
 * frontend saves onto the song row — MediaController serves them back.
 *
 * Files live on the 'local' disk at music/{user_id}/{uuid}.{ext}. NOTE:
 * on Laravel Cloud the local filesystem is ephemeral (wiped on deploy);
 * production needs a mounted bucket or S3 disk for uploads to survive.
 */
class UploadSongController extends Controller
{
    /** Per-user storage budget for uploads, in bytes (500 MB). */
    private const QUOTA_BYTES = 500 * 1024 * 1024;

    public function __invoke(Request $request): JsonResponse
    {
        $request->validate([
            // ~40 MB max — a full album-length FLAC won't fit, normal songs will.
            'audio' => ['required', 'file', 'max:40960', 'mimes:mp3,mpga,m4a,mp4,aac,ogg,oga,opus,wav,flac,webm'],
            'cover' => ['nullable', 'file', 'max:2048', 'mimes:jpg,jpeg,png,webp,gif'],
        ]);

        $disk = Storage::disk('local');
        $dir = 'music/'.$request->user()->id;

        $used = array_sum(array_map(fn ($f) => $disk->size($f), $disk->files($dir)));
        if ($used + $request->file('audio')->getSize() > self::QUOTA_BYTES) {
            return response()->json([
                'success' => false,
                'error' => 'Storage limit reached (500 MB). Delete some uploaded songs first.',
            ], 422);
        }

        $audioName = (string) Str::uuid().'.'.$request->file('audio')->extension();
        $request->file('audio')->storeAs($dir, $audioName, 'local');

        $coverUrl = '';
        if ($request->hasFile('cover')) {
            $coverName = (string) Str::uuid().'.'.$request->file('cover')->extension();
            $request->file('cover')->storeAs($dir, $coverName, 'local');
            $coverUrl = '/media/'.$coverName;
        }

        return response()->json([
            'success' => true,
            'mp3_url' => '/media/'.$audioName,
            'cover' => $coverUrl,
        ]);
    }
}
