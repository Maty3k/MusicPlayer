<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Session\Middleware\AuthenticateSession;

/**
 * A changed password (or PIN) signs every other device out: each session
 * remembers the password hash it was opened under and ends when that hash
 * is no longer the account's. Without it a session, once open, outlives a
 * password change or reset for as long as it stays in use.
 *
 * Three things the framework's middleware leaves out:
 *  - it keeps one hash per session and nothing about whose it is, so a
 *    session that turns up under another account (a sign-in that kept the
 *    session, a test acting as two users) starts counting afresh;
 *  - it stores the hash only on requests that arrive signed in, so the
 *    session handed out by a sign-in carried none, and a copy kept back
 *    from that moment would have taken on the new hash later;
 *  - a request that overlapped a password change made on this device can
 *    write the old hash back. The device then also holds a "stay signed in"
 *    cookie made after the change, which proves it has the new password.
 */
class EndSessionsOnPasswordChange extends AuthenticateSession
{
    public function handle($request, Closure $next)
    {
        if ($request->hasSession() && $request->user()) {
            $owner = (string) $request->user()->getAuthIdentifier();

            if ((string) $request->session()->get('password_hash_owner') !== $owner) {
                $request->session()->forget($this->hashKey());
                $request->session()->put('password_hash_owner', $owner);
            } elseif ($this->cookieHasCurrentPassword($request)) {
                $request->session()->forget($this->hashKey());
            }
        }

        $response = parent::handle($request, $next);

        // Bind the session to the password the moment it signs in.
        $user = $this->guard()->user();
        if ($request->hasSession() && $user && $user->getAuthPassword()
            && ! $request->session()->has($this->hashKey())) {
            $request->session()->put('password_hash_owner', (string) $user->getAuthIdentifier());
            $this->storePasswordHashInSession($request);
        }

        return $response;
    }

    private function hashKey(): string
    {
        return 'password_hash_'.$this->auth->getDefaultDriver();
    }

    /** The request's "stay signed in" cookie is this account's and was made with its current password. */
    private function cookieHasCurrentPassword($request): bool
    {
        $user = $request->user();
        $parts = explode('|', (string) $request->cookies->get($this->guard()->getRecallerName()), 3);

        return count($parts) === 3
            && $parts[0] === (string) $user->getAuthIdentifier()
            && (string) $user->getRememberToken() !== ''
            && hash_equals((string) $user->getRememberToken(), $parts[1])
            && $this->validatePasswordHash($user->getAuthPassword(), $parts[2]);
    }
}
