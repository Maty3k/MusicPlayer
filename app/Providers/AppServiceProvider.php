<?php

namespace App\Providers;

use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Session\Middleware\AuthenticateSession;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->configureRateLimits();

        // The links in the reset and verification mails are built from
        // APP_URL, never from the request: a forged Host header must not be
        // able to point them at someone else's site.
        ResetPassword::createUrlUsing(fn (object $user, string $token) => rtrim((string) config('app.url'), '/')
            .route('password.reset', ['token' => $token, 'email' => $user->getEmailForPasswordReset()], false));
        VerifyEmail::createUrlUsing(function (object $user) {
            $urls = app('url');
            $urls->forceRootUrl(rtrim((string) config('app.url'), '/'));
            try {
                return $urls->temporarySignedRoute(
                    'verification.verify',
                    now()->addMinutes((int) config('auth.verification.expire', 60)),
                    ['id' => $user->getKey(), 'hash' => sha1($user->getEmailForVerification())],
                );
            } finally {
                $urls->forceRootUrl(null);
            }
        });

        // A session ended by a password change lands on the login page with
        // a sentence saying why (resources/views/auth/login.blade.php).
        AuthenticateSession::redirectUsing(fn () => route('login', ['ended' => 1]));
    }

    /**
     * Limits that need more than "N a minute". Accounts are free and instant,
     * so anything that costs money or grows the database also gets a daily
     * ceiling, per account and (for the paid calls) for the whole site.
     */
    private function configureRateLimits(): void
    {
        $who = fn (Request $request): string => (string) ($request->user()?->getAuthIdentifier() ?? $request->ip());

        // POST /save-music: generous for listening, searching and adding songs
        // one by one (the Song Scanner adds a whole folder that way; the size
        // of a library is bounded by config/library.php), tighter for the
        // actions that rewrite a playlist or add many rows at once. A limit
        // answers in the page's own shape, so every place that shows
        // result.error says what happened.
        $tooFast = fn (Request $request, array $headers) => response()->json([
            'success' => false,
            'rateLimited' => true,
            'error' => 'Too many changes at once. Wait a few seconds and try again.',
        ], 429, $headers);

        RateLimiter::for('save-music', function (Request $request) use ($who, $tooFast) {
            $limits = [Limit::perMinute(1200)->by('save-music:'.$who($request))->response($tooFast)];

            $heavy = ['addBatch', 'createPlaylist', 'copySong', 'moveSong', 'reorder', 'delete', 'deletePlaylist', 'share'];
            if (in_array($request->input('action'), $heavy, true)) {
                $limits[] = Limit::perMinute(90)->by('save-music-heavy:'.$who($request))->response($tooFast);
            }

            return $limits;
        });

        // New accounts, from one address. One tap makes a member account, so
        // that route is the tighter one; a registration form can be sent a
        // few times before it validates.
        RateLimiter::for('new-member', fn (Request $request) => [
            Limit::perMinutes(10, 5)->by('new-member:'.$request->ip()),
            Limit::perDay(30)->by('new-member-day:'.$request->ip()),
        ]);
        RateLimiter::for('register', fn (Request $request) => [
            Limit::perMinute(10)->by('register:'.$request->ip()),
            Limit::perDay(40)->by('register-day:'.$request->ip()),
        ]);

        // The verification mail goes to whatever address the account was
        // registered with, which nobody has proven is theirs yet.
        RateLimiter::for('verification-mail', fn (Request $request) => [
            Limit::perMinute(3)->by('verification-mail:'.$who($request)),
            Limit::perDay(10)->by('verification-mail-day:'.$who($request)),
        ]);

        // Attaching an e-mail address needs no proof that it is yours, and a
        // reset mail can then be sent to it: a handful a day is plenty.
        RateLimiter::for('attach-email', fn (Request $request) => [
            Limit::perMinute(5)->by('attach-email:'.$who($request)),
            Limit::perDay(5)->by('attach-email-day:'.$who($request)),
        ]);

        // Calls that are paid for with the site's own Gemini key: per account
        // by the minute and by the day, and a daily total for everyone.
        RateLimiter::for('ai-suggestions', fn (Request $request) => [
            Limit::perMinute(5)->by('ai-suggestions:'.$who($request)),
            Limit::perDay(60)->by('ai-suggestions-day:'.$who($request)),
            Limit::perDay(1000)->by('ai-suggestions-everyone'),
        ]);
        RateLimiter::for('ai-scan', fn (Request $request) => [
            Limit::perMinute(10)->by('ai-scan:'.$who($request)),
            Limit::perDay(150)->by('ai-scan-day:'.$who($request)),
            Limit::perDay(1000)->by('ai-scan-everyone'),
        ]);
    }
}
