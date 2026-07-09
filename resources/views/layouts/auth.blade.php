<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>@yield('title', 'Music Player')</title>
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
