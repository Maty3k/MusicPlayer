@extends('layouts.auth')

@section('title', 'Forgot password — Music Player')

@section('content')
    <h1 class="auth-heading">Forgot your password?</h1>
    <p class="auth-sub">Tell us your email and we'll send you a link to pick a new one</p>

    @if (session('status') == 'reset-link-sent')
        <div class="auth-status">If that address has an account, a reset link is on its way. Check your spam folder too.</div>
    @endif

    @if (session('status') == 'reset-link-failed')
        <div class="auth-status auth-status-error">
            We couldn't send the email — the mail service rejected it. Please
            try again in a bit.
        </div>
    @endif

    @if ($errors->any())
        <div class="auth-errors">
            @foreach ($errors->all() as $error)
                <div class="auth-error">{{ $error }}</div>
            @endforeach
        </div>
    @endif

    <form method="POST" action="{{ route('password.email') }}">
        @csrf
        <div class="add-song-form-group">
            <label for="email">Email</label>
            <input type="email" id="email" name="email" value="{{ old('email') }}" placeholder="you@example.com" required autofocus autocomplete="email">
        </div>
        <button type="submit" class="add-song-btn-save auth-submit">Email me a reset link</button>
    </form>

    <div class="auth-alt">Remembered it after all? <a href="{{ route('login') }}">Log in</a></div>
@endsection
