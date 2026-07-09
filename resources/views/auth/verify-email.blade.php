@extends('layouts.auth')

@section('title', 'Verify email — Music Player')

@section('content')
    <h1 class="auth-heading">Verify your email</h1>
    <p class="auth-sub">
        We sent a verification link to <strong>{{ auth()->user()->email }}</strong>.
        Click the link in that email to unlock your collection. If it hasn't
        arrived, check your spam folder or resend it below.
    </p>

    @if (session('status') == 'verification-link-sent')
        <div class="auth-status">A new verification link has been sent to your email address.</div>
    @endif

    <form method="POST" action="{{ route('verification.send') }}">
        @csrf
        <button type="submit" class="add-song-btn-save auth-submit">Resend verification email</button>
    </form>

    <form method="POST" action="{{ route('logout') }}" class="auth-logout-form">
        @csrf
        <button type="submit" class="add-song-btn-cancel auth-submit-ghost">Log out</button>
    </form>
@endsection
