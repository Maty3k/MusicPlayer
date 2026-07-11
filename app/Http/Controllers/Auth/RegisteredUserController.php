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

        // No bootstrap playlist: the player greets a playlist-less account
        // with the first-run wizard so the user names their own.

        // Send the verification email — but never let a mail-transport failure
        // (e.g. Resend testing-mode restrictions, missing key) 500 the
        // registration. The account is created either way; the verify page
        // offers a resend and shows what went wrong.
        $mailFailed = false;
        try {
            event(new Registered($user));
        } catch (\Throwable $e) {
            report($e);
            $mailFailed = true;
        }

        Auth::login($user);

        return redirect()->route('verification.notice')
            ->with('status', $mailFailed ? 'verification-link-failed' : null);
    }
}
