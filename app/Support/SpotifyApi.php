<?php

namespace App\Support;

use App\Models\SpotifyToken;
use App\Models\User;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

/**
 * Spotify Web API access shared by the Spotify controllers and the library
 * importer: per-user OAuth tokens (refreshed on demand), the app-level
 * client-credentials token for public playlists, and thin HTTP wrappers.
 */
class SpotifyApi
{
    public const ACCOUNTS_URL = 'https://accounts.spotify.com/api/token';

    public const API_URL = 'https://api.spotify.com/v1';

    /**
     * Valid (refreshed-if-needed) access token for the user, or null.
     */
    public function userToken(User $user): ?string
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
     * App-level client-credentials token (public playlist imports).
     */
    public function clientToken(): ?string
    {
        $data = $this->accountsPost(['grant_type' => 'client_credentials']);

        return $data['access_token'] ?? null;
    }

    /**
     * The user's OAuth token if connected, else a client-credentials token.
     */
    public function anyToken(User $user): ?string
    {
        return $this->userToken($user) ?? $this->clientToken();
    }

    public function accountsPost(array $form): ?array
    {
        try {
            $response = Http::asForm()
                ->withBasicAuth(
                    (string) config('services.spotify.client_id'),
                    (string) config('services.spotify.client_secret'),
                )
                ->timeout(15)
                ->post(self::ACCOUNTS_URL, $form);
        } catch (ConnectionException) {
            return null;
        }

        return $response->successful() ? $response->json() : null;
    }

    /**
     * GET; null on any failure (connection error or non-2xx).
     */
    public function get(string $url, string $token, array $query = []): ?array
    {
        try {
            $response = Http::withToken($token)->timeout(15)->get($url, $query);
        } catch (ConnectionException) {
            return null;
        }

        return $response->successful() ? $response->json() : null;
    }

    /**
     * GET for paged library reads. Unlike get(), a 429 surfaces as a
     * SpotifyRateLimited exception (with Spotify's Retry-After) so a long
     * import can pause and resume instead of silently dropping a page.
     */
    public function getPage(string $url, string $token, array $query = []): ?array
    {
        try {
            $response = Http::withToken($token)->timeout(15)->get($url, $query);
        } catch (ConnectionException) {
            return null;
        }

        if ($response->status() === 429) {
            throw new SpotifyRateLimited(max(1, (int) $response->header('Retry-After')));
        }

        return $response->successful() ? $response->json() : null;
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
}
