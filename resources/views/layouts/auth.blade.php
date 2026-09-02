<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>@yield('title', 'Music Player')</title>
    {{-- PWA metas: an installed app that opens onto a logged-out page should
         still get the branded chrome + manifest, not a bare white tab --}}
    <link rel="manifest" href="/manifest.webmanifest">
    <meta name="theme-color" content="#14262b">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <link rel="apple-touch-icon" href="/icons/icon-192.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="{{ asset('css/styles.css') }}?v={{ filemtime(public_path('css/styles.css')) }}">
</head>
<body class="auth-page">
    <main class="auth-stage">
        <section class="auth-panel">
            <a class="auth-wordmark" href="{{ url('/') }}">Music Player</a>
            @yield('content')
        </section>
        {{-- The record: the one piece of scenery. Big and half off-stage on
             desktop, a small spinning disc above the form on phones. --}}
        <div class="auth-record" aria-hidden="true">
            <div class="auth-record-disc">
                <div class="auth-record-label">
                    <span class="auth-record-rpm">33&#8531;</span>
                    <span class="auth-record-side">rpm &middot; side A</span>
                </div>
            </div>
        </div>
    </main>
</body>
</html>
