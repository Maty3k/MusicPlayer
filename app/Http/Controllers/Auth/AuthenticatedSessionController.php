<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\Playlist;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;
use Illuminate\View\View;

class AuthenticatedSessionController extends Controller
{
    public function create(Request $request): View
    {
        // "Save this playlist" from a share page: remember it, so whichever
        // way the visitor then signs in or signs up (email, member number,
        // Spotify), the player offers to save it (PlayerController::pendingShare).
        $save = $request->query('save');
        if (is_string($save) && preg_match('/^[A-Za-z0-9]{8,64}$/', $save)
            && Playlist::where('share_token', $save)->exists()) {
            $request->session()->put('pending_share', ['token' => $save, 'at' => now()->timestamp]);
        }

        return view('auth.login');
    }

    public function store(Request $request): RedirectResponse
    {
        $credentials = $request->validate([
            'email' => ['required', 'string', 'email'],
            'password' => ['required', 'string'],
        ]);

        if (! Auth::attempt($credentials, $request->boolean('remember'))) {
            throw ValidationException::withMessages([
                'email' => __('auth.failed'),
            ]);
        }

        $request->session()->regenerate();

        return redirect()->intended(route('player'));
    }

    public function destroy(Request $request): RedirectResponse
    {
        Auth::guard('web')->logout();

        $request->session()->invalidate();
        $request->session()->regenerateToken();

        // Leave nothing of this account on the device: the offline copy of
        // the player page, saved songs and covers, the queue and recent
        // searches would otherwise stay for whoever uses the browser next.
        return redirect()->route('login')->header('Clear-Site-Data', '"cache", "storage"');
    }
}
