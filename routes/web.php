<?php

use App\Http\Controllers\Auth\AccountController;
use App\Http\Controllers\Auth\AuthenticatedSessionController;
use App\Http\Controllers\Auth\EmailVerificationController;
use App\Http\Controllers\Auth\MemberAccessController;
use App\Http\Controllers\Auth\NewPasswordController;
use App\Http\Controllers\Auth\PasswordResetLinkController;
use App\Http\Controllers\Auth\RegisteredUserController;
use App\Http\Controllers\CloudMusicController;
use App\Http\Controllers\MediaController;
use App\Http\Controllers\MusicController;
use App\Http\Controllers\PlayerController;
use App\Http\Controllers\RecommendationsController;
use App\Http\Controllers\ScanCoverController;
use App\Http\Controllers\SearchYoutubeController;
use App\Http\Controllers\SetupCheckController;
use App\Http\Controllers\SharedPlaylistController;
use App\Http\Controllers\SpotifyController;
use App\Http\Controllers\SpotifyLibraryController;
use App\Http\Controllers\SpotifyResolveController;
use App\Http\Controllers\UploadSongController;
use App\Http\Controllers\YoutubePlaylistController;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Route;
use Illuminate\View\Middleware\ShareErrorsFromSession;

// Public first-boot diagnostics (booleans only, no secrets) — reachable even
// when auth is broken, which is exactly when it's needed. Sessions are
// bypassed: with SESSION_DRIVER=database and a dead DB, the session
// middleware itself would 500 this page before it could diagnose anything.
Route::get('/setup-check', SetupCheckController::class)
    ->withoutMiddleware([
        StartSession::class,
        ShareErrorsFromSession::class,
        // L13's forgery middleware calls $request->session() even on GET.
        PreventRequestForgery::class,
    ]);

// Public read-only view of a shared playlist (no auth). Sessions stay on so
// the page knows whether the viewer is logged in (for the "add" button).
Route::get('/s/{token}', [SharedPlaylistController::class, 'show'])
    ->where('token', '[A-Za-z0-9]+')
    ->middleware('throttle:60,1,share-page')
    ->name('shared.show');

// Spotify OAuth. GET serves login/callback/token/status/logout/playlists.
// It sits outside the auth group because the callback is also where
// "Continue with Spotify" lands, before there is a session user; the
// controller checks auth for every other action.
Route::get('/spotify', [SpotifyController::class, 'handleGet'])->middleware('throttle:60,1,spotify');

// ---- Guest auth ----
Route::middleware('guest')->group(function () {
    Route::get('/auth/spotify', [SpotifyController::class, 'redirectToLogin'])
        ->middleware('throttle:10,1,spotify-login')->name('spotify.login');
    Route::get('/register', [RegisteredUserController::class, 'create'])->name('register');
    Route::post('/register', [RegisteredUserController::class, 'store'])->middleware('throttle:register');
    Route::get('/login', [AuthenticatedSessionController::class, 'create'])->name('login');
    Route::post('/login', [AuthenticatedSessionController::class, 'store'])->middleware('throttle:10,1,login');

    // Vinyl-club instant access: one tap creates a member-number account,
    // and members log back in with number + PIN. Tighter throttle on start
    // (each hit creates a DB row) than on login.
    Route::post('/member/start', [MemberAccessController::class, 'start'])
        ->middleware('throttle:new-member')->name('member.start');
    Route::post('/member/login', [MemberAccessController::class, 'login'])
        ->middleware('throttle:10,1,member-login')->name('member.login');

    // Password reset. The 'password.reset' route name is what the framework's
    // ResetPassword notification uses to build the emailed link.
    Route::get('/forgot-password', [PasswordResetLinkController::class, 'create'])->name('password.request');
    Route::post('/forgot-password', [PasswordResetLinkController::class, 'store'])
        ->middleware('throttle:6,1,forgot-password')->name('password.email');
    Route::get('/reset-password/{token}', [NewPasswordController::class, 'create'])->name('password.reset');
    Route::post('/reset-password', [NewPasswordController::class, 'store'])
        ->middleware('throttle:6,1,reset-password')->name('password.update');
});

// ---- Authenticated (verification pending allowed) ----
Route::middleware('auth')->group(function () {
    Route::post('/logout', [AuthenticatedSessionController::class, 'destroy'])->name('logout');

    Route::get('/email/verify', [EmailVerificationController::class, 'notice'])
        ->name('verification.notice');
    Route::get('/email/verify/{id}/{hash}', [EmailVerificationController::class, 'verify'])
        ->middleware('signed')->name('verification.verify');
    Route::post('/email/verification-notification', [EmailVerificationController::class, 'send'])
        ->middleware('throttle:verification-mail')->name('verification.send');
});

// ---- The app (must be logged in AND verified) ----
Route::middleware(['auth', 'verified'])->group(function () {
    Route::get('/', [PlayerController::class, 'show'])->name('player');

    // Same action-based contract as the legacy save-music.php, per user.
    Route::post('/save-music', MusicController::class)->middleware('throttle:save-music');

    // User-owned audio uploads (offline-capable playback source) and the
    // authenticated route that serves them back with Range support.
    // Batch-friendly: a dropped album/library imports one request per file.
    Route::post('/upload-song', UploadSongController::class)->middleware('throttle:120,5,upload-song');
    Route::get('/media/{filename}', MediaController::class)
        ->where('filename', '[A-Za-z0-9.\-]+');

    // The Cloudflare source (Settings → Source): the friend's R2 bucket
    // behind his Worker. The page only ever talks to these; the Worker's
    // token is added on the server and never reaches a browser.
    Route::get('/cloud-music/list', [CloudMusicController::class, 'list'])->middleware('throttle:cloud-music-list');
    Route::get('/cloud-music/file', [CloudMusicController::class, 'file'])->middleware('throttle:cloud-music-file');
    Route::post('/cloud-music/upload', [CloudMusicController::class, 'upload'])->middleware('throttle:cloud-music-upload');

    // Spotify POST serves import_url/playlist_tracks; the GET side lives
    // outside this group (see below) because its callback also serves guests.
    Route::post('/spotify', [SpotifyController::class, 'handlePost'])->middleware('throttle:30,1,spotify-post');

    // Whole-library import (Liked Songs + every playlist). The browser drives
    // it in many short chunks, hence the roomier throttle.
    Route::post('/spotify-library', SpotifyLibraryController::class)->middleware('throttle:240,1,spotify-library');

    // Account settings (fetch/JSON from the Settings modal)
    Route::post('/settings/name', [AccountController::class, 'updateName'])->middleware('throttle:10,1,settings');
    Route::post('/settings/password', [AccountController::class, 'updatePassword'])->middleware('throttle:10,1,settings');
    Route::post('/settings/email', [AccountController::class, 'attachEmail'])->middleware('throttle:attach-email');

    Route::post('/spotify-resolve', SpotifyResolveController::class)->middleware('throttle:20,1,spotify-resolve');
    // Its own bucket: searching as you type mustn't use up the budget that
    // a pasted playlist link then needs for its import.
    Route::post('/search-youtube', SearchYoutubeController::class)->middleware('throttle:70,1,search-youtube');
    Route::post('/youtube-playlist', YoutubePlaylistController::class)->middleware('throttle:20,1,youtube-playlist');
    Route::post('/scan-cover', ScanCoverController::class)->middleware('throttle:ai-scan');
    Route::post('/recommendations', RecommendationsController::class)->middleware('throttle:ai-suggestions');

    // Copy a shared playlist into the current user's library.
    Route::post('/s/{token}/add', [SharedPlaylistController::class, 'add'])
        ->where('token', '[A-Za-z0-9]+')->middleware('throttle:20,1,share-add')->name('shared.add');
});
