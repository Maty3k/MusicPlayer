<?php

namespace App\Providers;

use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
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

        // The link in a reset mail is built from APP_URL, never from the
        // request: a forged Host header must not be able to point it at
        // someone else's site.
        ResetPassword::createUrlUsing(fn (object $user, string $token) => rtrim((string) config('app.url'), '/')
            .route('password.reset', ['token' => $token, 'email' => $user->getEmailForPasswordReset()], false));
    }

    /**
     * Limits that need more than "N a minute". Accounts are free and instant,
     * so anything that costs money or grows the database also gets a daily
     * ceiling, per account and (for the paid calls) for the whole site.
     */
    private function configureRateLimits(): void
    {
        $who = fn (Request $request): string => (string) ($request->user()?->getAuthIdentifier() ?? $request->ip());

        // POST /save-music: generous for listening and searching, tighter for
        // the actions that add rows or rewrite a whole playlist.
        RateLimiter::for('save-music', function (Request $request) use ($who) {
            $limits = [Limit::perMinute(600)->by('save-music:'.$who($request))];

            $writes = ['add', 'addBatch', 'createPlaylist', 'copySong', 'moveSong', 'reorder', 'delete', 'deletePlaylist', 'share'];
            if (in_array($request->input('action'), $writes, true)) {
                $limits[] = Limit::perMinute(90)->by('save-music-write:'.$who($request));
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
