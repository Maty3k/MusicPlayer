<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Password;
use Illuminate\View\View;

class PasswordResetLinkController extends Controller
{
    public function create(): View
    {
        return view('auth.forgot-password');
    }

    public function store(Request $request): RedirectResponse
    {
        $request->validate([
            'email' => ['required', 'string', 'lowercase', 'email'],
        ]);

        // Same mail-failure handling as registration/verification: never let
        // a transport problem 500 the page.
        try {
            $status = Password::sendResetLink($request->only('email'));
        } catch (\Throwable $e) {
            report($e);

            return back()->with('status', 'reset-link-failed');
        }

        if ($status === Password::RESET_THROTTLED) {
            return back()->withErrors(['email' => __($status)]);
        }

        // INVALID_USER gets the same success message as RESET_LINK_SENT so
        // the form can't be used to probe which emails have accounts.
        return back()->with('status', 'reset-link-sent');
    }
}
