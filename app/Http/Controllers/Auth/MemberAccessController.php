<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\ValidationException;

/**
 * Instant "vinyl club" accounts: one tap deals the visitor a member number
 * and a 6-digit PIN — no email, no form. The pair is the login credential
 * (PIN hashed into `password`); an email can be attached later in Settings.
 * Members who joined before October 2026 still have a 4-digit PIN.
 */
class MemberAccessController extends Controller
{
    private const PIN_DIGITS = 6;

    /**
     * Wrong PINs a member number takes before it locks. Member numbers are
     * handed out in order, so anyone can name one: the count has to be per
     * number, not per visitor. The short window stops a burst; the daily one
     * turns "try every PIN of this member" from hours into years.
     */
    private const NUMBER_TRIES = 5;

    private const NUMBER_WINDOW = 15 * 60;

    private const NUMBER_TRIES_PER_DAY = 20;

    /** Wrong PINs one address gets per hour, over all member numbers. */
    private const ADDRESS_TRIES = 30;

    public function start(Request $request): RedirectResponse
    {
        $pin = str_pad((string) random_int(0, 10 ** self::PIN_DIGITS - 1), self::PIN_DIGITS, '0', STR_PAD_LEFT);

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
        // A dealt PIN is all digits but shares the password column — a member
        // who later sets a real password logs in here with that instead.
        $validated = $request->validate([
            'member_number' => ['required', 'string', 'max:16'],
            'pin' => ['required', 'string', 'min:4', 'max:255'],
        ]);

        // The card shows "#0042" — accept that, "0042", or "42".
        $number = (int) preg_replace('/\D/', '', $validated['member_number']);

        // Counted for any number, real or not, so a lock never tells whether
        // a member exists. While one is on, the right PIN is refused too:
        // letting it through would let the guessing carry on.
        $limits = [
            ['member-pin:'.$number, self::NUMBER_TRIES, self::NUMBER_WINDOW],
            ['member-pin-day:'.$number, self::NUMBER_TRIES_PER_DAY, 24 * 60 * 60],
            ['member-pin-from:'.$request->ip(), self::ADDRESS_TRIES, 60 * 60],
        ];
        foreach ($limits as [$key, $tries]) {
            if (RateLimiter::tooManyAttempts($key, $tries)) {
                throw ValidationException::withMessages([
                    'member_number' => 'Too many wrong PINs. Try again in '.$this->waitText(RateLimiter::availableIn($key)).'.',
                ]);
            }
        }

        $attempt = ['member_number' => $number, 'password' => $validated['pin']];
        if ($number < 1 || ! Auth::attempt($attempt, remember: true)) {
            foreach ($limits as [$key, , $window]) {
                RateLimiter::hit($key, $window);
            }

            throw ValidationException::withMessages([
                'member_number' => 'That member number and PIN don\'t match.',
            ]);
        }

        // The member is in: their number starts from zero again. The count
        // for the address stays, or one own account would reset it at will.
        RateLimiter::clear('member-pin:'.$number);
        RateLimiter::clear('member-pin-day:'.$number);

        $request->session()->regenerate();

        return redirect()->intended(route('player'));
    }

    /** "1 minute", "12 minutes", "3 hours": how long a lock still lasts. */
    private function waitText(int $seconds): string
    {
        $minutes = max(1, (int) ceil($seconds / 60));
        if ($minutes < 90) {
            return $minutes === 1 ? '1 minute' : $minutes.' minutes';
        }

        return ((int) ceil($minutes / 60)).' hours';
    }
}
