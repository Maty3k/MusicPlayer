<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{ $name }} — shared playlist</title>
    <style>
        :root { --gold:#d4a574; --gold-hi:#e8c48f; --cream:#f2e8d8; --ink:#17120d; }
        * { box-sizing:border-box; }
        body { margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; background:#17120d; color:var(--cream); min-height:100vh; }
        .wrap { max-width:640px; margin:0 auto; padding:26px 18px 60px; }
        .topbar { display:flex; align-items:center; justify-content:space-between; margin-bottom:26px; }
        .brand { font-size:0.78rem; letter-spacing:3px; text-transform:uppercase; color:var(--gold); text-decoration:none; }
        .brand:hover { color:var(--gold-hi); }
        .hero { display:flex; gap:18px; align-items:center; margin-bottom:22px; }
        .hero-disc { width:92px; height:92px; border-radius:12px; flex:0 0 auto; background:linear-gradient(135deg, var(--pl) 0%, rgba(0,0,0,0.35) 130%); display:flex; align-items:center; justify-content:center; box-shadow:0 10px 30px rgba(0,0,0,0.45); }
        .hero-disc svg { width:40px; height:40px; color:rgba(0,0,0,0.4); }
        .hero-info h1 { margin:0 0 5px; font-size:1.65rem; font-weight:400; line-height:1.2; }
        .hero-info .sub { color:rgba(212,165,116,0.7); font-size:0.85rem; letter-spacing:0.5px; }
        .cta { margin:20px 0 26px; }
        .btn { display:inline-block; padding:12px 22px; border-radius:999px; font-size:0.95rem; font-weight:600; text-decoration:none; cursor:pointer; border:none; font-family:inherit; }
        .btn-gold { background:linear-gradient(180deg,var(--gold-hi),var(--gold)); color:var(--ink); }
        .btn-gold:hover { filter:brightness(1.05); }
        form { display:inline; margin:0; }
        .flash { background:rgba(92,186,92,0.14); border:1px solid rgba(92,186,92,0.4); color:#bfe6bf; padding:10px 14px; border-radius:10px; margin-bottom:18px; font-size:0.9rem; }
        .tracks { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:5px; }
        .track { display:flex; align-items:center; gap:12px; padding:6px; border-radius:10px; }
        .track:hover { background:rgba(212,165,116,0.05); }
        .track .n { width:22px; text-align:center; color:rgba(212,165,116,0.4); font-size:0.8rem; flex:0 0 auto; }
        .track img, .track .noimg { width:44px; height:44px; border-radius:7px; object-fit:cover; flex:0 0 auto; background:rgba(0,0,0,0.35); }
        .track .noimg { display:flex; align-items:center; justify-content:center; color:rgba(212,165,116,0.4); }
        .track .meta { min-width:0; flex:1; }
        .track .t { font-size:0.92rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .track .a { font-size:0.76rem; color:rgba(212,165,116,0.6); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .empty { color:rgba(212,165,116,0.6); text-align:center; padding:40px 10px; }
        .foot { margin-top:34px; text-align:center; color:rgba(212,165,116,0.4); font-size:0.72rem; letter-spacing:0.5px; }
    </style>
</head>
<body>
<div class="wrap">
    <div class="topbar">
        <a class="brand" href="/">&#9834; Vinyl Room</a>
        @unless ($authed)<a class="brand" href="/login">Log in</a>@endunless
    </div>

    @if (session('status'))<div class="flash">{{ session('status') }}</div>@endif

    <div class="hero">
        <div class="hero-disc" style="--pl: {{ $color }}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.4"/></svg>
        </div>
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
                    <span class="noimg"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg></span>
                @endif
                <span class="meta">
                    <div class="t">{{ $s['title'] }}</div>
                    @if (!empty($s['artist']))<div class="a">{{ $s['artist'] }}</div>@endif
                </span>
            </li>
            @endforeach
        </ol>
    @endif

    <div class="foot">Shared from Vinyl Room</div>
</div>
</body>
</html>
