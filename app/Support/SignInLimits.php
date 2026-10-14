<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\ValidationException;

/**
 * Wrong PINs and passwords, counted per account wherever they are typed: the
 * member sign-in, the e-mail sign-in (a member who attached an e-mail signs
 * in there with the same PIN), and the "current PIN or password" box in
 * Settings. Per account, because member numbers are handed out in order and
 * anyone can name one. An account locks for 15 minutes after 5 wrong tries
 * and for a day after 20; one address gets 30 wrong tries an hour over all
 * accounts. A lock refuses the right secret too, or the guessing could go on.
 */
class SignInLimits
{
    private const TRIES = 5;

    private const WINDOW = 15 * 60;

    private const TRIES_PER_DAY = 20;

    private const ADDRESS_TRIES = 30;

    /** The account a member number names, whether or not it exists: a lock must tell nothing. */
    public static function forMemberNumber(int $number): string
    {
        return 'member:'.$number;
    }

    /** The account an e-mail address names; a member's own count when the address is theirs. */
    public static function forEmail(string $email): string
    {
        $email = mb_strtolower(trim($email));
        $user = User::where('email', $email)->first();

        return $user !== null ? self::forUser($user) : 'email:'.sha1($email);
    }

    public static function forUser(User $user): string
    {
        return $user->member_number !== null
            ? self::forMemberNumber((int) $user->member_number)
            : 'user:'.$user->getKey();
    }

    /** Refuse, naming the wait, while any count is over its limit. */
    public static function ensureNotLocked(string $account, ?Request $request, string $field): void
    {
        $wait = self::lockedFor($account, $request);
        if ($wait > 0) {
            throw ValidationException::withMessages([$field => self::lockedMessage($wait)]);
        }
    }

    /** Count one wrong secret. Returns how long the account is now locked, 0 when it is not. */
    public static function failed(string $account, ?Request $request): int
    {
        foreach (self::limits($account, $request) as [$key, , $window]) {
            RateLimiter::hit($key, $window);
        }

        return self::lockedFor($account, $request);
    }

    /** The right secret starts the account's count again (not the address's). */
    public static function succeeded(string $account): void
    {
        foreach (self::limits($account, null) as [$key]) {
            RateLimiter::clear($key);
        }
    }

    public static function lockedMessage(int $seconds): string
    {
        return 'Too many wrong PINs or passwords. Try again in '.self::waitText($seconds).'.';
    }

    /** Said with the wrong-PIN answer that set the lock, so nobody is told one try too late. */
    public static function nowLockedMessage(int $seconds): string
    {
        return 'After several wrong tries this account is locked for '.self::waitText($seconds).'.';
    }

    /** @return list<array{0: string, 1: int, 2: int}> key, tries allowed, window in seconds */
    private static function limits(string $account, ?Request $request): array
    {
        $limits = [
            ['sign-in:'.$account, self::TRIES, self::WINDOW],
            ['sign-in-day:'.$account, self::TRIES_PER_DAY, 24 * 60 * 60],
        ];
        if ($request !== null) {
            $limits[] = ['sign-in-from:'.$request->ip(), self::ADDRESS_TRIES, 60 * 60];
        }

        return $limits;
    }

    /** The longest wait among the counts that are over their limit; 0 when none is. */
    private static function lockedFor(string $account, ?Request $request): int
    {
        $wait = 0;
        foreach (self::limits($account, $request) as [$key, $tries]) {
            if (RateLimiter::tooManyAttempts($key, $tries)) {
                $wait = max($wait, RateLimiter::availableIn($key));
            }
        }

        return $wait;
    }

    /** "1 minute", "12 minutes", "3 hours". */
    private static function waitText(int $seconds): string
    {
        $minutes = max(1, (int) ceil($seconds / 60));
        if ($minutes < 90) {
            return $minutes === 1 ? '1 minute' : $minutes.' minutes';
        }

        return ((int) ceil($minutes / 60)).' hours';
    }
}
