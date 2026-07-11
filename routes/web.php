<?php

use App\Http\Controllers\Auth\AccountController;
use App\Http\Controllers\Auth\AuthenticatedSessionController;
use App\Http\Controllers\Auth\EmailVerificationController;
use App\Http\Controllers\Auth\RegisteredUserController;
use App\Http\Controllers\MediaController;
use App\Http\Controllers\Auth\NewPasswordController;
use App\Http\Controllers\Auth\PasswordResetLinkController;
use App\Http\Controllers\MusicController;
use App\Http\Controllers\PlayerController;
use App\Http\Controllers\ScanCoverController;
use App\Http\Controllers\SetupCheckController;
use App\Http\Controllers\SearchYoutubeController;
use App\Http\Controllers\SpotifyController;
use App\Http\Controllers\SpotifyResolveController;
use App\Http\Controllers\UploadSongController;
use Illuminate\Support\Facades\Route;

// Public first-boot diagnostics (booleans only, no secrets) — reachable even
// when auth is broken, which is exactly when it's needed. Sessions are
// bypassed: with SESSION_DRIVER=database and a dead DB, the session
// middleware itself would 500 this page before it could diagnose anything.
Route::get('/setup-check', SetupCheckController::class)
    ->withoutMiddleware([
        \Illuminate\Session\Middleware\StartSession::class,
        \Illuminate\View\Middleware\ShareErrorsFromSession::class,
        // L13's forgery middleware calls $request->session() even on GET.
        \Illuminate\Foundation\Http\Middleware\PreventRequestForgery::class,
    ]);

// ---- Guest auth ----
Route::middleware('guest')->group(function () {
    Route::get('/register', [RegisteredUserController::class, 'create'])->name('register');
    Route::post('/register', [RegisteredUserController::class, 'store'])->middleware('throttle:10,1');
    Route::get('/login', [AuthenticatedSessionController::class, 'create'])->name('login');
    Route::post('/login', [AuthenticatedSessionController::class, 'store'])->middleware('throttle:10,1');

    // Password reset. The 'password.reset' route name is what the framework's
    // ResetPassword notification uses to build the emailed link.
    Route::get('/forgot-password', [PasswordResetLinkController::class, 'create'])->name('password.request');
    Route::post('/forgot-password', [PasswordResetLinkController::class, 'store'])
        ->middleware('throttle:6,1')->name('password.email');
    Route::get('/reset-password/{token}', [NewPasswordController::class, 'create'])->name('password.reset');
    Route::post('/reset-password', [NewPasswordController::class, 'store'])
        ->middleware('throttle:6,1')->name('password.update');
});

// ---- Authenticated (verification pending allowed) ----
Route::middleware('auth')->group(function () {
    Route::post('/logout', [AuthenticatedSessionController::class, 'destroy'])->name('logout');

    Route::get('/email/verify', [EmailVerificationController::class, 'notice'])
        ->name('verification.notice');
    Route::get('/email/verify/{id}/{hash}', [EmailVerificationController::class, 'verify'])
        ->middleware('signed')->name('verification.verify');
    Route::post('/email/verification-notification', [EmailVerificationController::class, 'send'])
        ->middleware('throttle:6,1')->name('verification.send');
});

// ---- The app (must be logged in AND verified) ----
Route::middleware(['auth', 'verified'])->group(function () {
    Route::get('/', [PlayerController::class, 'show'])->name('player');

    // Same action-based contract as the legacy save-music.php, per user.
    Route::post('/save-music', MusicController::class);

    // User-owned audio uploads (offline-capable playback source) and the
    // authenticated route that serves them back with Range support.
    // Batch-friendly: a dropped album/library imports one request per file.
    Route::post('/upload-song', UploadSongController::class)->middleware('throttle:120,5');
    Route::get('/media/{filename}', MediaController::class)
        ->where('filename', '[A-Za-z0-9.\-]+');

    // Spotify: GET serves login/callback/token/status/logout/playlists,
    // POST serves import_url/playlist_tracks (mirrors the legacy split).
    Route::get('/spotify', [SpotifyController::class, 'handleGet'])->middleware('throttle:60,1');
    Route::post('/spotify', [SpotifyController::class, 'handlePost'])->middleware('throttle:30,1');

    // Account settings (fetch/JSON from the Settings modal)
    Route::post('/settings/name', [AccountController::class, 'updateName'])->middleware('throttle:10,1');
    Route::post('/settings/password', [AccountController::class, 'updatePassword'])->middleware('throttle:10,1');

    Route::post('/spotify-resolve', SpotifyResolveController::class)->middleware('throttle:20,1');
    Route::post('/search-youtube', SearchYoutubeController::class)->middleware('throttle:20,1');
    Route::post('/scan-cover', ScanCoverController::class)->middleware('throttle:10,1');
});
