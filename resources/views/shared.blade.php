<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{ $name }} — shared playlist</title>
    <meta name="theme-color" content="#14262b">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
    {{-- Self-contained on purpose: a shared link should load light, without
         the player's stylesheet. Values mirror the app's design tokens. --}}
    <style>
        :root {
            --ink: #14262b; --sleeve: #1c353b; --surface-hi: #24444b;
            --cream: #fbf5ea; --cream-60: rgba(251, 245, 234, 0.72); --cream-40: rgba(251, 245, 234, 0.5);
            --line: rgba(251, 245, 234, 0.16);
            --amber: #f2b45c; --amber-hi: #ffc873; --on-amber: #241a0f;
            --display: 'Bricolage Grotesque', 'Inter', -apple-system, sans-serif;
        }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            min-height: 100vh;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background: radial-gradient(ellipse 70% 40% at 50% -10%, rgba(242, 180, 92, 0.18), transparent 70%), var(--ink);
            color: var(--cream);
        }
        .wrap { max-width: 640px; margin: 0 auto; padding: 28px 20px 64px; }
        .topbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 40px; }
        .brand { font-family: var(--display); font-weight: 600; font-size: 0.95rem; letter-spacing: -0.01em; color: var(--cream-60); text-decoration: none; }
        .brand:hover { color: var(--cream); }
        .hero { display: flex; gap: 22px; align-items: center; margin-bottom: 26px; }
        .hero-disc {
            position: relative; flex: 0 0 auto; width: 108px; height: 108px; overflow: hidden; border-radius: 16px;
            background: linear-gradient(135deg, var(--pl) 0%, color-mix(in srgb, var(--pl) 50%, #000) 100%);
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4), inset 0 0 0 1px rgba(255, 255, 255, 0.08);
        }
        /* A record peeking out of the sleeve */
        .hero-disc::after {
            content: ''; position: absolute; top: 16px; right: -36px; width: 76px; height: 76px; border-radius: 50%;
            background: repeating-radial-gradient(circle at center, #131110 0 1.5px, #1d1915 1.5px 3.5px);
            box-shadow: 0 6px 16px rgba(0, 0, 0, 0.5);
        }
        .hero-disc::before {
            content: ''; position: absolute; z-index: 1; top: 40px; right: -12px; width: 28px; height: 28px; border-radius: 50%;
            background: var(--amber); box-shadow: inset 0 0 0 1px rgba(26, 19, 12, 0.2);
        }
        .hero-info { min-width: 0; }
        .hero-info h1 { margin: 0 0 6px; font-family: var(--display); font-size: clamp(1.8rem, 1.2rem + 2vw, 2.4rem); font-weight: 600; letter-spacing: -0.03em; line-height: 1.05; overflow-wrap: anywhere; }
        .hero-info .sub { color: var(--cream-60); font-size: 0.95rem; }
        .cta { margin: 0 0 32px; }
        .btn {
            display: inline-flex; align-items: center; justify-content: center; min-height: 50px; padding: 0 22px; border: 0; border-radius: 14px;
            font: inherit; font-size: 0.95rem; font-weight: 600; text-decoration: none; cursor: pointer; transition: background 0.15s;
        }
        .btn-gold { background: var(--amber); color: var(--on-amber); }
        .btn-gold:hover { background: var(--amber-hi); }
        .btn-ghost { min-height: 40px; padding: 0 14px; background: rgba(251, 245, 234, 0.06); border: 1px solid var(--line); border-radius: 12px; color: var(--cream); font-size: 0.88rem; font-weight: 500; }
        .btn-ghost:hover { background: rgba(251, 245, 234, 0.1); }
        .btn:focus-visible { outline: 2px solid var(--amber); outline-offset: 3px; }
        form { display: inline; margin: 0; }
        .flash { margin-bottom: 20px; padding: 12px 14px; border-radius: 12px; background: rgba(92, 186, 92, 0.1); border: 1px solid rgba(92, 186, 92, 0.35); color: #9fdc9f; font-size: 0.88rem; line-height: 1.5; }
        .tracks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
        .track { display: flex; align-items: center; gap: 12px; padding: 8px 10px; border-radius: 12px; }
        .track:hover { background: rgba(251, 245, 234, 0.05); }
        .track .n { flex: 0 0 auto; width: 22px; text-align: center; color: var(--cream-40); font-size: 0.8rem; font-variant-numeric: tabular-nums; }
        .track img, .track .noimg { flex: 0 0 auto; width: 48px; height: 48px; border-radius: 10px; object-fit: cover; background: var(--surface-hi); }
        .track .noimg { display: flex; align-items: center; justify-content: center; color: var(--cream-40); }
        .track .meta { min-width: 0; flex: 1; }
        .track .t { font-size: 0.95rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .track .a { font-size: 0.8rem; color: var(--cream-40); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .empty { color: var(--cream-40); text-align: center; padding: 40px 10px; }
        .foot { margin-top: 44px; text-align: center; color: var(--cream-40); font-size: 0.8rem; }
        @media (max-width: 480px) {
            .hero { gap: 16px; }
            .hero-disc { width: 88px; height: 88px; }
            .hero-disc::after { top: 12px; right: -30px; width: 62px; height: 62px; }
            .hero-disc::before { top: 31px; right: -11px; width: 24px; height: 24px; }
        }
    </style>
</head>
<body>
<div class="wrap">
    <div class="topbar">
        <a class="brand" href="/">Music Player</a>
        @unless ($authed)<a class="btn btn-ghost" href="/login">Log in</a>@endunless
    </div>
    @if (session('status'))<div class="flash">{{ session('status') }}</div>@endif
    <div class="hero">
        <div class="hero-disc" style="--pl: {{ $color }}" aria-hidden="true"></div>
        <div class="hero-info">
            <h1>{{ $name }}</h1>
            <div class="sub">Shared playlist &middot; {{ $count }} {{ $count === 1 ? 'track' : 'tracks' }}</div>
        </div>
    </div>
    <div class="cta">
        @if ($authed)
            <form method="POST" action="{{ route('shared.add', $token) }}">
                @csrf
                <button type="submit" class="btn btn-gold">Add to my library</button>
            </form>
        @else
            <a class="btn btn-gold" href="/login">Log in to save this playlist</a>
        @endif
    </div>
    @if ($count === 0)
        <div class="empty">This playlist has no tracks yet.</div>
    @else
        <ol class="tracks">
            @foreach ($songs as $i => $s)
            <li class="track">
                <span class="n">{{ $i + 1 }}</span>
                @if (!empty($s['cover']))
                    <img src="{{ $s['cover'] }}" alt="" loading="lazy" referrerpolicy="no-referrer">
                @else
                    <span class="noimg"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg></span>
                @endif
                <span class="meta">
                    <div class="t">{{ $s['title'] }}</div>
                    @if (!empty($s['artist']))<div class="a">{{ $s['artist'] }}</div>@endif
                </span>
            </li>
            @endforeach
        </ol>
    @endif
    <div class="foot">Shared from Music Player</div>
</div>
</body>
</html>
