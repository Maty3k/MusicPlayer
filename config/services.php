<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    // App-level Spotify credentials (per-user OAuth tokens live in the
    // spotify_tokens table). Register APP_URL/spotify?action=callback as the
    // redirect URI in the Spotify developer dashboard.
    'spotify' => [
        'client_id' => env('SPOTIFY_CLIENT_ID'),
        'client_secret' => env('SPOTIFY_CLIENT_SECRET'),
        'redirect_uri' => env('SPOTIFY_REDIRECT_URI'),
    ],

    // Google Gemini — album-cover identification in the Song Scanner.
    // Optional: without it, cover-ID is skipped (audio-tag scanning still works).
    'gemini' => [
        'key' => env('GEMINI_API_KEY'),
    ],

    // Cloudflare Worker in front of the private R2 "music" bucket (Settings →
    // Source → Cloudflare). Optional: without a URL the option stays hidden.
    // The token is handed to the browser, which streams straight from the
    // Worker (that's what keeps playing on a locked iPhone).
    'cloud_music' => [
        'url' => rtrim((string) env('CLOUD_MUSIC_URL', ''), '/'),
        'token' => env('CLOUD_MUSIC_TOKEN', ''),
    ],

];
