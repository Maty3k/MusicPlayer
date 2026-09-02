<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Support\SpotifyApi;
use App\Support\SpotifyLibraryImporter;
use App\Support\SpotifyRateLimited;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

/**
 * Whole-library Spotify import, driven chunk by chunk from the browser:
 * `plan` lists Liked Songs + every playlist, `import` pulls a few pages of
 * one of them per call (see SpotifyLibraryImporter). Same action-based JSON
 * contract as the other endpoints.
 */
class SpotifyLibraryController extends Controller
{
    public function __construct(
        private SpotifyApi $spotify,
        private SpotifyLibraryImporter $importer,
    ) {}

    public function __invoke(Request $request): JsonResponse
    {
        $user = $request->user();
        $token = $this->spotify->userToken($user);
        if ($token === null) {
            return response()->json(['success' => false, 'error' => 'Connect Spotify first']);
        }

        try {
            $payload = match ($request->input('action', '')) {
                'plan' => $this->plan($token),
                'import' => $this->import($request, $user, $token),
                default => ['success' => false, 'error' => 'Invalid action'],
            };
        } catch (SpotifyRateLimited $e) {
            $payload = [
                'success' => false,
                'error' => 'Spotify asked us to slow down',
                'retry_after' => $e->retryAfter,
            ];
        }

        return response()->json($payload);
    }

    private function plan(string $token): array
    {
        $sources = $this->importer->plan($token);
        if ($sources === null) {
            return ['success' => false, 'error' => 'Could not read your Spotify library'];
        }

        return ['success' => true, 'sources' => $sources];
    }

    private function import(Request $request, User $user, string $token): array
    {
        $kind = $request->input('kind');
        $id = $request->input('id', '');
        $offset = filter_var($request->input('offset', 0), FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);

        $validId = $kind === 'liked'
            ? ($id === '' || $id === null)
            : (is_string($id) && preg_match('/^[A-Za-z0-9]{1,64}$/', $id) === 1);

        if (! in_array($kind, ['liked', 'playlist'], true) || ! $validId || $offset === false) {
            return ['success' => false, 'error' => 'Invalid import request'];
        }

        // Chunks of one library must not interleave (two tabs, a double
        // click): the first call would reset a playlist the other is filling.
        $result = Cache::lock('spotify-library-import:'.$user->id, 30)->get(
            fn () => $this->importer->importChunk($user, $token, $kind, (string) $id, $offset),
        );

        if ($result === false) {
            return ['success' => false, 'error' => 'An import is already running'];
        }
        if ($result === null) {
            return ['success' => false, 'error' => 'Could not read that playlist from Spotify'];
        }

        return ['success' => true] + $result;
    }
}
