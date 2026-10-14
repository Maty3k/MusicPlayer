<?php

namespace App\Http\Controllers;

use App\Models\Playlist;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class PlayerController extends Controller
{
    /**
     * Render the vinyl player with the same data shape the legacy index.php
     * built from music.json — playlists keyed by slug, plus active playlist,
     * its songs, current index/song, and recently played slugs.
     */
    public function show(Request $request): Response
    {
        $pendingShare = $this->pendingShare($request);

        $user = $request->user()->load('playlists.songs');

        $playlists = [];
        foreach ($user->playlists as $playlist) {
            $playlists[$playlist->slug] = $playlist->toFrontend();
        }

        // Existing public-share links, keyed by playlist slug (for the edit modal).
        $shareTokens = $user->playlists
            ->filter(fn ($p) => ! empty($p->share_token))
            ->mapWithKeys(fn ($p) => [$p->slug => url('/s/'.$p->share_token)])
            ->all();

        // Identity keys of the user's favorites, for the song-row heart state.
        $favPlaylist = $user->playlists->firstWhere('slug', 'favorites');
        $favoriteKeys = $favPlaylist
            ? $favPlaylist->songs->map(fn ($s) => $s->frontendKey())->unique()->values()->all()
            : [];

        $active = $user->activePlaylist();
        $activePlaylistId = $active?->slug ?? 'favorites';
        $activePlaylist = $playlists[$activePlaylistId] ?? ['name' => 'Favorites', 'songs' => [], 'currentIndex' => 0, 'color' => '#d4a574'];
        $songs = $activePlaylist['songs'];
        $currentIndex = min($activePlaylist['currentIndex'], max(count($songs) - 1, 0));
        $current = $songs[$currentIndex] ?? [];

        $page = response()->view('music.player', [
            'playlists' => $playlists,
            'activePlaylistId' => $activePlaylistId,
            'activePlaylist' => $activePlaylist,
            'songs' => $songs,
            'currentIndex' => $currentIndex,
            'current' => $current,
            'recentlyPlayed' => $user->recently_played ?? array_keys($playlists),
            'recentSongs' => $user->recentSongs(),
            'favoriteKeys' => $favoriteKeys,
            'shareTokens' => $shareTokens,
            'pendingShare' => $pendingShare,
        ]);

        // The first page after "Start listening" shows the new member's PIN.
        // It must not be kept: the service worker stores the player page as
        // its offline copy and skips one marked no-store (public/sw.js).
        if ($request->session()->has('member_card')) {
            $page->header('Cache-Control', 'no-store');
        }

        return $page;
    }

    /**
     * A playlist the visitor asked to save from a share page before signing
     * in (see AuthenticatedSessionController::create), offered once on their
     * first visit to the player. It's an offer, not a copy: the ?save= link
     * could have come from anyone, so saving takes the user's own click
     * (a CSRF-protected POST to the share page's add route).
     *
     * @return array{token: string, name: string, count: int}|null
     */
    private function pendingShare(Request $request): ?array
    {
        $pending = $request->session()->pull('pending_share');
        if (! is_array($pending) || ! is_string($pending['token'] ?? null)
            || now()->timestamp - (int) ($pending['at'] ?? 0) > 15 * 60) {
            return null;
        }
        $source = Playlist::where('share_token', $pending['token'])->withCount('songs')->first();
        if ($source === null || $source->user_id === $request->user()->id) {
            return null;
        }

        return ['token' => $source->share_token, 'name' => (string) $source->name, 'count' => (int) $source->songs_count];
    }
}
