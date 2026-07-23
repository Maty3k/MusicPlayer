<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>@yield('title', 'Music Player')</title>
    {{-- PWA metas: an installed app that opens onto a logged-out page should
         still get the branded chrome + manifest, not a bare white tab --}}
    <link rel="manifest" href="/manifest.webmanifest">
    <meta name="theme-color" content="#1a1510">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <link rel="apple-touch-icon" href="/icons/icon-192.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="{{ asset('css/styles.css') }}?v={{ filemtime(public_path('css/styles.css')) }}">
</head>
<body class="auth-page">
    <div class="auth-vinyl-decor" aria-hidden="true">
        <div class="auth-vinyl-disc"></div>
    </div>
    <div class="auth-card">
        <div class="auth-brand">
            <div class="auth-brand-icon">&#9834;</div>
            <div class="auth-brand-title">Music Player</div>
        </div>
        @yield('content')
    </div>
</body>
</html>
