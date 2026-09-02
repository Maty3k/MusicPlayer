@extends('layouts.auth')

@section('title', 'Log in — Music Player')

@section('content')
    <h1 class="auth-heading">Welcome back</h1>
    <p class="auth-sub">Log in to spin your records</p>

    @if (session('status') == 'password-reset')
        <div class="auth-status">Your password has been reset. Log in with the new one.</div>
    @endif

    @if ($errors->any())
        <div class="auth-errors">
            @foreach ($errors->all() as $error)
                <div class="auth-error">{{ $error }}</div>
            @endforeach
        </div>
    @endif

    {{-- Instant access: one tap deals a member number + PIN, no form. --}}
    <form method="POST" action="{{ route('member.start') }}" class="member-start-form">
        @csrf
        <button type="submit" class="add-song-btn-save auth-submit member-start-btn">&#9834; New here? Start listening</button>
        <p class="member-start-hint">No email needed — you'll get a member card with your number and PIN.</p>
    </form>

    @if (config('services.spotify.client_id'))
        {{-- Spotify sign-in: one tap, and the whole library can be imported right after. --}}
        <a href="{{ route('spotify.login') }}" class="spotify-connect-btn auth-spotify-btn">
            <span class="spotify-glyph">&#9835;</span> Continue with Spotify
        </a>
        <p class="member-start-hint">Signs you in and lets you import your playlists and Liked Songs.</p>
    @endif

    <div class="auth-divider"><span>already a member?</span></div>

    <form method="POST" action="{{ route('member.login') }}">
        @csrf
        <div class="member-login-row">
            <div class="add-song-form-group">
                <label for="member_number">Member number</label>
                <input type="text" id="member_number" name="member_number" value="{{ old('member_number') }}" placeholder="#0042" inputmode="numeric" required autocomplete="username">
            </div>
            <div class="add-song-form-group">
                <label for="pin">PIN</label>
                <input type="password" id="pin" name="pin" placeholder="&#8226;&#8226;&#8226;&#8226;" required autocomplete="current-password">
            </div>
        </div>
        <button type="submit" class="add-song-btn-save auth-submit">Log in with my number</button>
    </form>

    <details class="auth-email-details" @if($errors->has('email') || $errors->has('password') || old('email')) open @endif>
        <summary>Log in with email instead</summary>
        <form method="POST" action="{{ route('login') }}">
            @csrf
            <div class="add-song-form-group">
                <label for="email">Email</label>
                <input type="email" id="email" name="email" value="{{ old('email') }}" placeholder="you@example.com" autocomplete="email">
            </div>
            <div class="add-song-form-group">
                <label for="password">Password</label>
                <input type="password" id="password" name="password" placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;" autocomplete="current-password">
            </div>
            <div class="auth-row">
                <label class="auth-remember">
                    <input type="checkbox" name="remember" value="1">
                    <span>Remember me</span>
                </label>
                <a class="auth-forgot" href="{{ route('password.request') }}">Forgot password?</a>
            </div>
            <button type="submit" class="add-song-btn-save auth-submit">Log in</button>
        </form>
    </details>

    <div class="auth-alt">Prefer a full account? <a href="{{ route('register') }}">Create one with email</a></div>
@endsection
