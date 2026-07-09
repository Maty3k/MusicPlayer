<?php

namespace App\Http\Controllers;

use App\Models\SpotifyToken;
use App\Models\User;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * Spotify integration: OAuth (per-user tokens), Web Playback SDK token,
 * connection status, and playlist import. Mirrors the legacy spotify.php
 * action-based contract (GET: login/callback/token/status/logout/playlists,
 * POST: import_url/playlist_tracks) with identical JSON shapes.
 */
class SpotifyController extends Controller
{
    public function handleGet(Request $request): JsonResponse|RedirectResponse
    {
        return match ($request->query('action', '')) {
            'login' => $this->login($request),
            'callback' => $this->callback($request),
            'token' => $this->token($request),
            'status' => $this->status($request),
            'logout' => $this->logout($request),
            'playlists' => $this->playlists($request),
            default => response()->json(['error' => 'Unknown action']),
        };
    }

    public function handlePost(Request $request): JsonResponse
    {
        return match ($request->input('action', '')) {
            'import_url' => $this->importUrl($request),
            'playlist_tracks' => $this->playlistTracks($request),
            default => response()->json(['error' => 'Unknown action']),
        };
    }

    // ============================================================
    // ROUTE: LOGIN — start OAuth flow
    // ============================================================
    private function login(Request $request): JsonResponse
    {
        if (empty(config('services.spotify.client_id')) || empty(config('services.spotify.redirect_uri'))) {
            return response()->json(['error' => 'Fill in config.php first']);
        }

        $state = Str::random(32);
        $request->session()->put('spotify_state', $state);

        $authUrl = 'https://accounts.spotify.com/authorize?'.http_build_query([
            'client_id' => config('services.spotify.client_id'),
            'response_type' => 'code',
            'redirect_uri' => config('services.spotify.redirect_uri'),
            'scope' => 'streaming user-read-email user-read-private playlist-read-private playlist-read-collaborative user-library-read',
            'state' => $state,
        ]);

        return response()->json(['authUrl' => $authUrl]);
    }

    // ============================================================
    // ROUTE: CALLBACK — handle OAuth redirect from Spotify
    // ============================================================
    private function callback(Request $request): RedirectResponse
    {
        $code = (string) $request->query('code', '');
        $error = (string) $request->query('error', '');
        $state = (string) $request->query('state', '');

        // Verify the CSRF state parameter we set on `login`.
        $expected = (string) $request->session()->pull('spotify_state', '');
        if ($error !== '' || $code === '' || $state === '' || $expected === '' || ! hash_equals($expected, $state)) {
            return redirect('/?spotify=error');
        }

        $data = $this->accountsPost([
            'grant_type' => 'authorization_code',
            'code' => $code,
            'redirect_uri' => config('services.spotify.redirect_uri'),
        ]);

        if (! empty($data['access_token'])) {
            $request->user()->spotifyToken()->updateOrCreate([], [
                'access_token' => $data['access_token'],
                'refresh_token' => $data['refresh_token'] ?? '',
                'expires_at' => now()->addSeconds((int) ($data['expires_in'] ?? 3600)),
            ]);

            return redirect('/?spotify=connected');
        }

        return redirect('/?spotify=error');
    }

    // ============================================================
    // ROUTE: TOKEN — return access token for Web Playback SDK
    // ============================================================
    private function token(Request $request): JsonResponse
    {
        $token = $this->validUserToken($request->user());
        if ($token !== null) {
            return response()->json(['access_token' => $token]);
        }

        return response()->json(['error' => 'Not authenticated'], 401);
    }

    // ============================================================
    // ROUTE: STATUS — check connection + user info
    // ============================================================
    private function status(Request $request): JsonResponse
    {
        if (empty(config('services.spotify.client_id'))) {
            return response()->json(['configured' => false, 'connected' => false]);
        }

        $token = $this->validUserToken($request->user());
        if ($token === null) {
            return response()->json(['configured' => true, 'connected' => false]);
        }

        $user = $this->spotifyGet('https://api.spotify.com/v1/me', $token);
        if ($user) {
            return response()->json([
                'configured' => true,
                'connected' => true,
                'user' => [
                    'name' => $user['display_name'] ?? '',
                    'image' => $user['images'][0]['url'] ?? '',
                    'premium' => ($user['product'] ?? '') === 'premium',
                ],
            ]);
        }

        return response()->json(['configured' => true, 'connected' => false]);
    }

    // ============================================================
    // ROUTE: LOGOUT — clear the user's tokens
    // ============================================================
    private function logout(Request $request): JsonResponse
    {
        $request->user()->spotifyToken()->delete();

        return response()->json(['success' => true]);
    }

    // ============================================================
    // ROUTE: PLAYLISTS — get user's playlists (OAuth required)
    // ============================================================
    private function playlists(Request $request): JsonResponse
    {
        $token = $this->validUserToken($request->user());
        if ($token === null) {
            return response()->json(['success' => false, 'error' => 'Not connected']);
        }

        $playlists = [];
        $offset = 0;
        do {
            $data = $this->spotifyGet('https://api.spotify.com/v1/me/playlists', $token, [
                'offset' => $offset,
                'limit' => 50,
            ]);
            if (! $data || empty($data['items'])) {
                break;
            }
            foreach ($data['items'] as $pl) {
                $playlists[] = [
                    'id' => $pl['id'],
                    'name' => $pl['name'],
                    'image' => $pl['images'][0]['url'] ?? '',
                    'tracks' => $pl['tracks']['total'] ?? 0,
                    'owner' => $pl['owner']['display_name'] ?? '',
                ];
            }
            $offset += 50;
        } while (! empty($data['next']));

        return response()->json(['success' => true, 'playlists' => $playlists]);
    }

    // ============================================================
    // ROUTE: IMPORT_URL — import from public playlist URL (no OAuth needed)
    // ============================================================
    private function importUrl(Request $request): JsonResponse
    {
        $url = (string) $request->input('url', '');
        $playlistId = $this->extractPlaylistId($url);
        if ($playlistId === '') {
            return response()->json(['success' => false, 'error' => 'Invalid Spotify playlist URL']);
        }

        $token = $this->anyToken($request->user());
        if ($token === null) {
            return response()->json(['success' => false, 'error' => 'Spotify not configured']);
        }

        $info = $this->spotifyGet("https://api.spotify.com/v1/playlists/{$playlistId}", $token, [
            'fields' => 'name,images,tracks.total',
        ]);
        if (! $info) {
            return response()->json(['success' => false, 'error' => 'Could not fetch playlist — is it public?']);
        }

        $songs = $this->fetchPlaylistTracks($playlistId, $token);

        return response()->json([
            'success' => true,
            'name' => $info['name'] ?? 'Untitled',
            'image' => $info['images'][0]['url'] ?? '',
            'songs' => $songs,
            'total' => count($songs),
        ]);
    }

    // ============================================================
    // ROUTE: PLAYLIST_TRACKS — get tracks from a specific playlist
    // ============================================================
    private function playlistTracks(Request $request): JsonResponse
    {
        $playlistId = (string) $request->input('playlist_id', '');
        if ($playlistId === '') {
            return response()->json(['success' => false, 'error' => 'No playlist ID']);
        }

        $token = $this->anyToken($request->user());
        if ($token === null) {
            return response()->json(['success' => false, 'error' => 'Not authenticated']);
        }

        $songs = $this->fetchPlaylistTracks($playlistId, $token);

        return response()->json(['success' => true, 'songs' => $songs]);
    }

    // ============================================================
    // TOKEN HELPERS
    // ============================================================

    /**
     * Valid (refreshed-if-needed) access token for the user, or null.
     */
    private function validUserToken(User $user): ?string
    {
        $stored = $user->spotifyToken;
        if ($stored === null) {
            return null;
        }

        if ($stored->expires_at === null || $stored->expires_at->lt(now()->addSeconds(60))) {
            $stored = $this->refreshAccessToken($stored);
        }

        return $stored?->access_token ?: null;
    }

    /**
     * Refresh an expired token via the refresh_token grant and persist it.
     * Keeps the old refresh_token when Spotify doesn't return a new one.
     */
    private function refreshAccessToken(SpotifyToken $stored): ?SpotifyToken
    {
        if (empty($stored->refresh_token)) {
            return null;
        }

        $data = $this->accountsPost([
            'grant_type' => 'refresh_token',
            'refresh_token' => $stored->refresh_token,
        ]);

        if (! empty($data['access_token'])) {
            $stored->access_token = $data['access_token'];
            $stored->expires_at = now()->addSeconds((int) ($data['expires_in'] ?? 3600));
            if (! empty($data['refresh_token'])) {
                $stored->refresh_token = $data['refresh_token'];
            }
            $stored->save();

            return $stored;
        }

        return null;
    }

    /**
     * App-level client-credentials token (public playlist imports).
     */
    private function clientToken(): ?string
    {
        $data = $this->accountsPost(['grant_type' => 'client_credentials']);

        return $data['access_token'] ?? null;
    }

    /**
     * The user's OAuth token if connected, else a client-credentials token.
     */
    private function anyToken(User $user): ?string
    {
        return $this->validUserToken($user) ?? $this->clientToken();
    }

    // ============================================================
    // HTTP HELPERS
    // ============================================================

    private function accountsPost(array $form): ?array
    {
        try {
            $response = Http::asForm()
                ->withBasicAuth(
                    (string) config('services.spotify.client_id'),
                    (string) config('services.spotify.client_secret'),
                )
                ->timeout(15)
                ->post('https://accounts.spotify.com/api/token', $form);
        } catch (ConnectionException) {
            return null;
        }

        return $response->successful() ? $response->json() : null;
    }

    private function spotifyGet(string $url, string $token, array $query = []): ?array
    {
        try {
            $response = Http::withToken($token)->timeout(15)->get($url, $query);
        } catch (ConnectionException) {
            return null;
        }

        return $response->successful() ? $response->json() : null;
    }

    // ============================================================
    // IMPORT HELPERS
    // ============================================================

    private function extractPlaylistId(string $url): string
    {
        if (preg_match('/playlist\/([a-zA-Z0-9]+)/', $url, $m)) {
            return $m[1];
        }

        return '';
    }

    /**
     * Page through a playlist's tracks (100/page), preferring covers >= 300px.
     *
     * @return array<int, array<string, mixed>>
     */
    private function fetchPlaylistTracks(string $playlistId, string $token): array
    {
        $songs = [];
        $offset = 0;
        $fields = 'items(track(id,name,artists,album(name,images),duration_ms)),total,next';

        do {
            $data = $this->spotifyGet("https://api.spotify.com/v1/playlists/{$playlistId}/tracks", $token, [
                'offset' => $offset,
                'limit' => 100,
                'fields' => $fields,
            ]);
            if (! $data || empty($data['items'])) {
                break;
            }

            foreach ($data['items'] as $item) {
                $t = $item['track'] ?? null;
                if (! $t || empty($t['name'])) {
                    continue;
                }

                $artists = array_map(fn ($a) => $a['name'], $t['artists'] ?? []);
                $cover = '';
                foreach ($t['album']['images'] ?? [] as $img) {
                    if (($img['width'] ?? 0) >= 300) {
                        $cover = $img['url'];
                        break;
                    }
                }
                if (! $cover && ! empty($t['album']['images'])) {
                    $cover = $t['album']['images'][0]['url'] ?? '';
                }

                $songs[] = [
                    'title' => $t['name'],
                    'artist' => implode(', ', $artists),
                    'album' => $t['album']['name'] ?? '',
                    'cover' => $cover,
                    'spotify_id' => $t['id'] ?? '',
                    'duration_ms' => $t['duration_ms'] ?? 0,
                ];
            }
            $offset += 100;
        } while (! empty($data['next']));

        return $songs;
    }
}
