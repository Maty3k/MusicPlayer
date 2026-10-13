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
 * The framework's middleware keeps one hash per session and nothing about
 * whose it is. A session that turns up under another account (a sign-in
 * that kept the session, a test acting as two users) therefore starts
 * counting afresh instead of being thrown out.
 */
class EndSessionsOnPasswordChange extends AuthenticateSession
{
    public function handle($request, Closure $next)
    {
        if ($request->hasSession() && $request->user()) {
            $owner = (string) $request->user()->getAuthIdentifier();

            if ((string) $request->session()->get('password_hash_owner') !== $owner) {
                $request->session()->forget('password_hash_'.$this->auth->getDefaultDriver());
                $request->session()->put('password_hash_owner', $owner);
            }
        }

        return parent::handle($request, $next);
    }
}
