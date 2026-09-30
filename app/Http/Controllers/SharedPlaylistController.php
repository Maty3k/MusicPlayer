<?php

namespace App\Http\Controllers;

use App\Models\Playlist;
use App\Support\SharedPlaylistCopier;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

/**
 * Public read-only view of a playlist shared via /s/{token}, plus an
 * authenticated "add to my library" copy. Only playlists with a matching
 * share_token are reachable; the token is unguessable and revocable.
 */
class SharedPlaylistController extends Controller
{
    /** Public preview — no auth required. */
    public function show(Request $request, string $token): View
    {
        $playlist = Playlist::where('share_token', $token)->with('songs')->first();
        abort_if($playlist === null, 404);

        $songs = $playlist->songs->map(fn ($s) => [
            'title' => (string) $s->title,
            'artist' => (string) ($s->artist ?? ''),
            'cover' => SharedPlaylistCopier::publicCover($s->cover),
        ])->all();

        return view('shared', [
            'name' => (string) $playlist->name,
            'color' => preg_match('/^#[0-9a-fA-F]{6}$/', (string) $playlist->color) ? $playlist->color : '#d4a574',
            'token' => $token,
            'songs' => $songs,
            'count' => count($songs),
            // Only show the "Add" button to a viewer who can actually add — the
            // add route is behind 'verified', so an unverified user's click
            // would bounce to the verify-email page instead of copying.
            'authed' => $request->user()?->hasVerifiedEmail() ?? false,
        ]);
    }

    /** Copy a shared playlist into the authenticated user's library. */
    public function add(Request $request, string $token): RedirectResponse
    {
        $source = Playlist::where('share_token', $token)->first();
        abort_if($source === null, 404);

        return redirect('/')->with('status', SharedPlaylistCopier::copy($request->user(), $source));
    }
}
