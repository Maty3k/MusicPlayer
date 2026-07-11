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

    <form method="POST" action="{{ route('login') }}">
        @csrf
        <div class="add-song-form-group">
            <label for="email">Email</label>
            <input type="email" id="email" name="email" value="{{ old('email') }}" placeholder="you@example.com" required autofocus autocomplete="email">
        </div>
        <div class="add-song-form-group">
            <label for="password">Password</label>
            <input type="password" id="password" name="password" placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;" required autocomplete="current-password">
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

    <div class="auth-alt">No account yet? <a href="{{ route('register') }}">Create one</a></div>
@endsection
