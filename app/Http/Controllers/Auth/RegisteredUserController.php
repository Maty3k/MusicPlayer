<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Auth\Events\Registered;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\Rules\Password;
use Illuminate\View\View;

class RegisteredUserController extends Controller
{
    public function create(): View
    {
        return view('auth.register');
    }

    public function store(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:100'],
            'email' => ['required', 'string', 'lowercase', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'confirmed', Password::min(8)],
        ]);

        $user = User::create($validated);

        // Every account starts with the bootstrap playlist the player expects.
        $user->playlists()->create([
            'slug' => 'favorites',
            'name' => 'Favorites',
            'position' => 0,
        ]);
        $user->update(['active_playlist_slug' => 'favorites', 'recently_played' => ['favorites']]);

        event(new Registered($user)); // sends the verification email

        Auth::login($user);

        return redirect()->route('verification.notice');
    }
}
