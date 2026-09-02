<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Support\SpotifyApi;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;

/**
 * Spotify integration: OAuth (per-user tokens), Web Playback SDK token,
 * connection status, and playlist import. Mirrors the legacy spotify.php
 * action-based contract (GET: login/callback/token/status/logout/playlists,
 * POST: import_url/playlist_tracks) with identical JSON shapes. Token and
 * HTTP plumbing lives in SpotifyApi, shared with the whole-library importer
 * (SpotifyLibraryController).
 *
 * The same OAuth flow also powers "Continue with Spotify" on the login page:
 * the callback then signs the visitor in (creating the account on first use)
 * instead of attaching a token to an existing session.
 */
class SpotifyController extends Controller
{
    public const SCOPES = 'streaming user-read-email user-read-private playlist-read-private playlist-read-collaborative user-library-read';

    public function __construct(private SpotifyApi $spotify) {}

    public function handleGet(Request $request): JsonResponse|RedirectResponse
    {
        $action = (string) $request->query('action', '');

        // The callback must work for guests: "Continue with Spotify" lands
        // here before there is a session user. Every other action is per-user.
        $user = $request->user();
        if ($action !== 'callback' && ($user === null || ! $user->hasVerifiedEmail())) {
            return response()->json(['error' => 'Not authenticated'], 401);
        }

        return match ($action) {
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
    // ROUTE: /auth/spotify — "Continue with Spotify" (guests)
    // ============================================================
    public function redirectToLogin(Request $request): RedirectResponse
    {
        if (! $this->configured()) {
            return redirect()->route('login')->withErrors(['spotify' => 'Spotify sign-in is not set up on this server yet.']);
        }

        return redirect()->away($this->authorizeUrl($request, 'login'));
    }

    // ============================================================
    // ROUTE: LOGIN — start the connect flow from Settings
    // ============================================================
    private function login(Request $request): JsonResponse
    {
        if (! $this->configured()) {
            return response()->json(['error' => 'Fill in config.php first']);
        }

        return response()->json(['authUrl' => $this->authorizeUrl($request, 'connect')]);
    }

    private function configured(): bool
    {
        return ! empty(config('services.spotify.client_id')) && ! empty(config('services.spotify.redirect_uri'));
    }

    /**
     * Spotify consent URL. The random state guards the callback against CSRF;
     * the flow ("login" or "connect") tells the callback what to do with the
     * token it gets back.
     */
    private function authorizeUrl(Request $request, string $flow): string
    {
        $state = Str::random(32);
        $request->session()->put('spotify_state', $state);
        $request->session()->put('spotify_flow', $flow);

        return 'https://accounts.spotify.com/authorize?'.http_build_query([
            'client_id' => config('services.spotify.client_id'),
            'response_type' => 'code',
            'redirect_uri' => config('services.spotify.redirect_uri'),
            'scope' => self::SCOPES,
            'state' => $state,
        ]);
    }

    // ============================================================
    // ROUTE: CALLBACK — handle OAuth redirect from Spotify
    // ============================================================
    private function callback(Request $request): RedirectResponse
    {
        $flow = (string) $request->session()->pull('spotify_flow', 'connect');
        $failed = $flow === 'login'
            ? redirect()->route('login')->withErrors(['spotify' => 'Spotify sign-in did not complete. Please try again.'])
            : redirect('/?spotify=error');

        $code = (string) $request->query('code', '');
        $error = (string) $request->query('error', '');
        $state = (string) $request->query('state', '');

        // Verify the CSRF state parameter set when the flow started.
        $expected = (string) $request->session()->pull('spotify_state', '');
        if ($error !== '' || $code === '' || $state === '' || $expected === '' || ! hash_equals($expected, $state)) {
            return $failed;
        }

        $data = $this->spotify->accountsPost([
            'grant_type' => 'authorization_code',
            'code' => $code,
            'redirect_uri' => config('services.spotify.redirect_uri'),
        ]);
        if (empty($data['access_token'])) {
            return $failed;
        }

        $profile = $this->spotify->get(SpotifyApi::API_URL.'/me', $data['access_token']);
        $spotifyUserId = is_array($profile) ? trim((string) ($profile['id'] ?? '')) : '';

        $user = $request->user();
        if ($flow === 'login') {
            if ($spotifyUserId === '') {
                return $failed;
            }
            $user = User::query()->where('spotify_user_id', $spotifyUserId)->first()
                ?? $this->createSpotifyUser($spotifyUserId, $profile);
            Auth::login($user, remember: true);
            $request->session()->regenerate();
        } elseif ($user === null) {
            return $failed;
        }

        // Link the Spotify account to this user so "Continue with Spotify"
        // lands here next time — unless another account already holds it
        // (connecting the same Spotify twice must not hijack the first).
        if ($spotifyUserId !== '' && $user->spotify_user_id !== $spotifyUserId) {
            $claimed = User::query()->where('spotify_user_id', $spotifyUserId)->whereKeyNot($user->getKey())->exists();
            if (! $claimed) {
                $user->forceFill(['spotify_user_id' => $spotifyUserId])->save();
            }
        }

        $user->spotifyToken()->updateOrCreate([], [
            'access_token' => $data['access_token'],
            'refresh_token' => $data['refresh_token'] ?? '',
            'expires_at' => now()->addSeconds((int) ($data['expires_in'] ?? 3600)),
        ]);

        return redirect($flow === 'login' ? '/?spotify=signed-in' : '/?spotify=connected');
    }

    /**
     * Account for a first-time "Continue with Spotify" sign-in. Spotify's
     * email claim is unverified, so it is not stored (that would let anyone
     * claim an address); like a member-number account, an email can be
     * attached and verified later in Settings.
     */
    private function createSpotifyUser(string $spotifyUserId, array $profile): User
    {
        $name = trim((string) ($profile['display_name'] ?? ''));

        return User::create([
            'name' => $name !== '' ? mb_substr($name, 0, 100) : 'Spotify listener',
            'password' => Str::random(40),
            'spotify_user_id' => $spotifyUserId,
        ]);
    }

    // ============================================================
    // ROUTE: TOKEN — return access token for Web Playback SDK
    // ============================================================
    private function token(Request $request): JsonResponse
    {
        $token = $this->spotify->userToken($request->user());
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

        $token = $this->spotify->userToken($request->user());
        if ($token === null) {
            return response()->json(['configured' => true, 'connected' => false]);
        }

        $user = $this->spotify->get('https://api.spotify.com/v1/me', $token);
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
        $token = $this->spotify->userToken($request->user());
        if ($token === null) {
            return response()->json(['success' => false, 'error' => 'Not connected']);
        }

        $playlists = [];
        $offset = 0;
        do {
            $data = $this->spotify->get('https://api.spotify.com/v1/me/playlists', $token, [
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

        $token = $this->spotify->anyToken($request->user());
        if ($token === null) {
            return response()->json(['success' => false, 'error' => 'Spotify not configured']);
        }

        $info = $this->spotify->get("https://api.spotify.com/v1/playlists/{$playlistId}", $token, [
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

        $token = $this->spotify->anyToken($request->user());
        if ($token === null) {
            return response()->json(['success' => false, 'error' => 'Not authenticated']);
        }

        $songs = $this->fetchPlaylistTracks($playlistId, $token);

        return response()->json(['success' => true, 'songs' => $songs]);
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
            $data = $this->spotify->get("https://api.spotify.com/v1/playlists/{$playlistId}/tracks", $token, [
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
