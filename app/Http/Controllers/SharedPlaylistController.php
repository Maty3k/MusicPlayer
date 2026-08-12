<?php

namespace App\Http\Controllers;

use App\Models\Playlist;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\View\View;

/**
 * Public read-only view of a playlist shared via /s/{token}, plus an
 * authenticated "add to my library" copy. Only playlists with a matching
 * share_token are reachable; the token is unguessable and revocable.
 */
class SharedPlaylistController extends Controller
{
    private const MAX_COPY = 200;

    /** Public preview — no auth required. */
    public function show(Request $request, string $token): View
    {
        $playlist = Playlist::where('share_token', $token)->with('songs')->first();
        abort_if($playlist === null, 404);

        $songs = $playlist->songs->map(fn ($s) => [
            'title' => (string) $s->title,
            'artist' => (string) ($s->artist ?? ''),
            'cover' => $this->publicCover($s->cover),
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
        $user = $request->user();
        $source = Playlist::where('share_token', $token)->with('songs')->first();
        abort_if($source === null, 404);

        do {
            $slug = 'pl-'.strtolower(Str::random(10));
        } while ($user->playlists()->where('slug', $slug)->exists());

        $new = $user->playlists()->create([
            'slug' => $slug,
            'name' => Str::limit((string) $source->name, 90, ''),
            'color' => preg_match('/^#[0-9a-fA-F]{6}$/', (string) $source->color) ? $source->color : '#d4a574',
            'current_index' => 0,
            'source' => 'user',
            'position' => ((int) ($user->playlists()->max('position') ?? -1)) + 1,
        ]);

        foreach ($source->songs->take(self::MAX_COPY)->values() as $i => $s) {
            // Cross-user trust boundary: accept only a canonical 11-char
            // youtube_id (same guard addBatch uses) so a crafted id from the
            // sharer can't reach the copier's player.
            $yt = (string) $s->youtube_id;
            $yt = preg_match('/^[A-Za-z0-9_-]{11}$/', $yt) ? $yt : '';
            $new->songs()->create([
                'position' => $i,
                'title' => (string) $s->title,
                'artist' => (string) $s->artist,
                'album' => (string) $s->album,
                'cover' => $this->publicCover($s->cover),
                'youtube_id' => $yt,
                'mp3_url' => '', // never copy the owner's private uploaded audio
                'spotify_id' => (string) $s->spotify_id,
            ]);
        }

        return redirect('/')->with('status', 'Added “'.$new->name.'” to your library.');
    }

    /**
     * Only expose external http(s) cover URLs — never the owner's private
     * /media uploads (they 404 for other users and shouldn't be referenced).
     */
    private function publicCover(?string $cover): string
    {
        $cover = trim((string) $cover);

        return preg_match('#^https?://#i', $cover) ? $cover : '';
    }
}
