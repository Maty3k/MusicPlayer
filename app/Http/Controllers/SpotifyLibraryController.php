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
 * `plan` lists the sources, `import` pulls a few pages of one of them per
 * call (see SpotifyLibraryImporter). Two ways in: the signed-in account's
 * own library through its OAuth token (Liked Songs + every playlist), or any
 * public profile through the app's own credentials (its public playlists
 * only). Same action-based JSON contract as the other endpoints.
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

        try {
            $payload = match ($request->input('action', '')) {
                'plan' => $this->plan($request, $user),
                'import' => $this->import($request, $user),
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

    private function plan(Request $request, User $user): array
    {
        $profile = $request->input('profile');
        if (is_string($profile) && trim($profile) !== '') {
            $spotifyUserId = SpotifyLibraryImporter::profileIdFrom($profile);
            if ($spotifyUserId === null) {
                return ['success' => false, 'error' => 'Paste a Spotify profile link (open.spotify.com/user/…)'];
            }
            $token = $this->spotify->anyToken($user);
            if ($token === null) {
                return ['success' => false, 'error' => 'Spotify is not configured on this server'];
            }
            $plan = $this->importer->planPublicProfile($spotifyUserId, $token);
            if ($plan === null) {
                return ['success' => false, 'error' => 'Could not read that profile. Is it public?'];
            }

            return ['success' => true] + $plan;
        }

        $token = $this->spotify->userToken($user);
        if ($token === null) {
            return ['success' => false, 'error' => 'Connect Spotify first, or paste a public profile link'];
        }
        $plan = $this->importer->plan($token);
        if ($plan === null) {
            return ['success' => false, 'error' => 'Could not read your Spotify library'];
        }

        return ['success' => true] + $plan;
    }

    private function import(Request $request, User $user): array
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

        // Liked Songs are only readable through the user's own token; public
        // playlists can also be read with the app's credentials.
        $token = $kind === 'liked' ? $this->spotify->userToken($user) : $this->spotify->anyToken($user);
        if ($token === null) {
            return [
                'success' => false,
                'error' => $kind === 'liked' ? 'Connect Spotify first' : 'Spotify is not configured on this server',
            ];
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
        // A ceiling was reached: what fitted is saved, and the page lists the
        // source with the sentence instead of carrying on.
        if (isset($result['error'])) {
            return ['success' => false] + $result;
        }

        return ['success' => true] + $result;
    }
}
