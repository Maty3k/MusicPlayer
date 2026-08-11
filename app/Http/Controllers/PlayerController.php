<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\View\View;

class PlayerController extends Controller
{
    /**
     * Render the vinyl player with the same data shape the legacy index.php
     * built from music.json — playlists keyed by slug, plus active playlist,
     * its songs, current index/song, and recently played slugs.
     */
    public function show(Request $request): View
    {
        $user = $request->user()->load('playlists.songs');

        $playlists = [];
        foreach ($user->playlists as $playlist) {
            $playlists[$playlist->slug] = $playlist->toFrontend();
        }

        $active = $user->activePlaylist();
        $activePlaylistId = $active?->slug ?? 'favorites';
        $activePlaylist = $playlists[$activePlaylistId] ?? ['name' => 'Favorites', 'songs' => [], 'currentIndex' => 0, 'color' => '#d4a574'];
        $songs = $activePlaylist['songs'];
        $currentIndex = min($activePlaylist['currentIndex'], max(count($songs) - 1, 0));
        $current = $songs[$currentIndex] ?? [];

        return view('music.player', [
            'playlists' => $playlists,
            'activePlaylistId' => $activePlaylistId,
            'activePlaylist' => $activePlaylist,
            'songs' => $songs,
            'currentIndex' => $currentIndex,
            'current' => $current,
            'recentlyPlayed' => $user->recently_played ?? array_keys($playlists),
            'recentSongs' => $user->recentSongs(),
        ]);
    }
}
