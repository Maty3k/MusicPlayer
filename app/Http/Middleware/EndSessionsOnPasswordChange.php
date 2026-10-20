<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Request;
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
 *  - the session handed out by a sign-in has to be bound to its owner too.
 *    Laravel 13.19 stored no hash at sign-in, and 13.38 stores one without
 *    an owner. Either way the next request started counting afresh, so a
 *    copy kept back from that moment would have taken on the new hash later;
 *  - a request that overlapped a password change made on this device can
 *    write the old hash back. The device then also holds a "stay signed in"
 *    cookie made after the change, which proves it has the new password.
 */
class EndSessionsOnPasswordChange extends AuthenticateSession
{
    public function handle($request, Closure $next)
    {
        // Laravel 13.38 no longer signs anyone in with a "stay signed in"
        // cookie made under an older password, so a device whose session ran
        // out arrives as a guest. End it the way a session ends here: drop
        // the cookie and say why on the login page (once, so it can't loop).
        if ($request->hasSession() && ! $request->user() && $this->cookieOutlivedItsPassword($request)) {
            $cookies = $this->guard()->getCookieJar();
            $cookies->queue($cookies->forget($this->guard()->getRecallerName()));

            if (! ($request->routeIs('login') && $request->query('ended'))) {
                throw new AuthenticationException('Unauthenticated.', [$this->auth->getDefaultDriver()], $this->redirectTo($request));
            }
        }

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

        // Bind the session to the password and its owner the moment it signs in.
        $user = $this->guard()->user();
        if ($request->hasSession() && $user && $user->getAuthPassword()) {
            $owner = (string) $user->getAuthIdentifier();

            if ((string) $request->session()->get('password_hash_owner') !== $owner
                || ! $request->session()->has($this->hashKey())) {
                $request->session()->put('password_hash_owner', $owner);
                $this->storePasswordHashInSession($request);
            }
        }

        return $response;
    }

    /**
     * A session ended here lands on the login page with a sentence saying
     * why (resources/views/auth/login.blade.php). Set here rather than with
     * redirectUsing(), which the framework's own guest redirect overrides.
     */
    protected function redirectTo(Request $request)
    {
        return route('login', ['ended' => 1]);
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

    /** The request's "stay signed in" cookie names an account and its current token, but an older password. */
    private function cookieOutlivedItsPassword($request): bool
    {
        $parts = explode('|', (string) $request->cookies->get($this->guard()->getRecallerName()), 3);
        if (count($parts) !== 3 || $parts[0] === '' || $parts[1] === '') {
            return false;
        }

        $user = $this->guard()->getProvider()->retrieveByToken($parts[0], $parts[1]);

        return $user !== null && (string) $user->getAuthPassword() !== ''
            && ! $this->validatePasswordHash($user->getAuthPassword(), $parts[2]);
    }
}
