<?php

use App\Http\Middleware\EndSessionsOnPasswordChange;
use App\Http\Middleware\SecurityHeaders;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Exceptions\ThrottleRequestsException;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Laravel Cloud terminates TLS at its load balancer; trust its proxy
        // headers so signed URLs (email verification) and redirects use https.
        // Only the direct caller counts as a proxy. Laravel 13.38's '*' trusts
        // every address, which makes the visitor's address the left-most
        // X-Forwarded-For entry, one they can write themselves, so every
        // per-address limit (PIN tries, new accounts, reset mails) could be
        // dodged. 'REMOTE_ADDR' is what '*' meant up to 13.19.
        $middleware->trustProxies(at: 'REMOTE_ADDR');

        // A changed password or PIN ends the sessions on every other device.
        $middleware->appendToGroup('web', EndSessionsOnPasswordChange::class);

        $middleware->append(SecurityHeaders::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // settings/* is consumed by fetch() in the Settings modal, and
        // cloud-music/* by the Cloudflare source (fetch, an upload, <audio>) —
        // validation and auth failures must come back as JSON, not redirects.
        // A rate limit on any JSON call must too: a 429 from /search-youtube
        // during an import has to read as "slow down", not as an HTML page.
        // The player's own calls to /save-music don't all ask for JSON, so
        // that path is named too.
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request, Throwable $e) => $request->is('api/*') || $request->is('settings/*') || $request->is('cloud-music/*')
                || ($e instanceof ThrottleRequestsException && ($request->expectsJson() || $request->is('save-music'))),
        );
    })->create();
