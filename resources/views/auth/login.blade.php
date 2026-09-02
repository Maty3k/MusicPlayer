@extends('layouts.auth')

@section('title', 'Log in — Music Player')

@section('content')
    <h1 class="auth-heading">Put a record on.</h1>
    <p class="auth-sub">Your collection, one tap away.</p>

    @if (session('status') == 'password-reset')
        <div class="auth-status">Password reset. Log in with the new one.</div>
    @endif

    @if ($errors->any())
        <div class="auth-errors" role="alert">
            @foreach ($errors->all() as $error)
                <div class="auth-error">{{ $error }}</div>
            @endforeach
        </div>
    @endif

    {{-- Instant access: one tap deals a member number + PIN, no form. --}}
    <form method="POST" action="{{ route('member.start') }}">
        @csrf
        <button type="submit" class="auth-btn auth-btn-primary">Start listening</button>
        <p class="auth-hint">No sign-up. You get a member number and PIN to come back with.</p>
    </form>

    @if (config('services.spotify.client_id'))
        <a href="{{ route('spotify.login') }}" class="auth-btn auth-btn-secondary">
            <span class="auth-spotify-glyph" aria-hidden="true">&#9835;</span> Continue with Spotify
        </a>
        <p class="auth-hint">Brings your playlists and Liked Songs along.</p>
    @endif

    <section class="auth-returning" aria-labelledby="authReturningTitle">
        <h2 class="auth-returning-title" id="authReturningTitle">Already a member?</h2>

        <form method="POST" action="{{ route('member.login') }}" class="auth-member-form">
            @csrf
            <label class="auth-field">
                <span>Member number</span>
                <input type="text" id="member_number" name="member_number" value="{{ old('member_number') }}" placeholder="#0042" inputmode="numeric" required autocomplete="username">
            </label>
            <label class="auth-field auth-field-pin">
                <span>PIN</span>
                <input type="password" id="pin" name="pin" placeholder="&#8226;&#8226;&#8226;&#8226;" required autocomplete="current-password">
            </label>
            <button type="submit" class="auth-btn auth-btn-ghost">Log in</button>
        </form>

        <details class="auth-email-details" @if($errors->has('email') || $errors->has('password') || old('email')) open @endif>
            <summary>Use email instead</summary>
            <form method="POST" action="{{ route('login') }}">
                @csrf
                <label class="auth-field">
                    <span>Email</span>
                    <input type="email" id="email" name="email" value="{{ old('email') }}" placeholder="you@example.com" autocomplete="email">
                </label>
                <label class="auth-field">
                    <span>Password</span>
                    <input type="password" id="password" name="password" placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;" autocomplete="current-password">
                </label>
                <div class="auth-row">
                    <label class="auth-remember">
                        <input type="checkbox" name="remember" value="1">
                        <span>Remember me</span>
                    </label>
                    <a class="auth-link" href="{{ route('password.request') }}">Forgot password?</a>
                </div>
                <button type="submit" class="auth-btn auth-btn-ghost auth-btn-block">Log in with email</button>
            </form>
        </details>
    </section>

    <p class="auth-alt">Prefer an email account? <a href="{{ route('register') }}">Create one</a></p>
@endsection
