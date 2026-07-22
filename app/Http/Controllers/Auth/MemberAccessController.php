<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;

/**
 * Instant "vinyl club" accounts: one tap deals the visitor a member number
 * and a 4-digit PIN — no email, no form. The pair is the login credential
 * (PIN hashed into `password`); an email can be attached later in Settings.
 */
class MemberAccessController extends Controller
{
    public function start(Request $request): RedirectResponse
    {
        $pin = str_pad((string) random_int(0, 9999), 4, '0', STR_PAD_LEFT);

        // Sequential numbers race under concurrent signups; the unique index
        // is the arbiter, so retry with a fresh max() a few times.
        $user = null;
        for ($attempt = 0; $attempt < 3 && $user === null; $attempt++) {
            try {
                $user = User::create([
                    'member_number' => (int) User::max('member_number') + 1,
                    'name' => 'New member',
                    'password' => $pin,
                ]);
            } catch (UniqueConstraintViolationException $e) {
                if ($attempt === 2) {
                    throw $e;
                }
            }
        }

        // Members always stay signed in — that's the point of the easy flow.
        Auth::login($user, remember: true);
        $request->session()->regenerate();

        // One-shot card for the welcome wizard: the PIN is only ever visible
        // in plaintext here, on the page right after it was dealt.
        $request->session()->flash('member_card', [
            'number' => $user->formattedMemberNumber(),
            'pin' => $pin,
        ]);

        return redirect()->route('player');
    }

    public function login(Request $request): RedirectResponse
    {
        // PIN starts as 4 digits but shares the password column — a member
        // who later sets a real password logs in here with that instead.
        $validated = $request->validate([
            'member_number' => ['required', 'string', 'max:16'],
            'pin' => ['required', 'string', 'min:4', 'max:255'],
        ]);

        // The card shows "#0042" — accept that, "0042", or "42".
        $number = (int) preg_replace('/\D/', '', $validated['member_number']);

        $attempt = ['member_number' => $number, 'password' => $validated['pin']];
        if ($number < 1 || ! Auth::attempt($attempt, remember: true)) {
            throw ValidationException::withMessages([
                'member_number' => 'That member number and PIN don\'t match.',
            ]);
        }

        $request->session()->regenerate();

        return redirect()->intended(route('player'));
    }
}
