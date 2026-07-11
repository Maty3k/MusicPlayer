@extends('layouts.auth')

@section('title', 'Reset password — Music Player')

@section('content')
    <h1 class="auth-heading">Pick a new password</h1>
    <p class="auth-sub">Choose something memorable — your records are waiting</p>

    @if ($errors->any())
        <div class="auth-errors">
            @foreach ($errors->all() as $error)
                <div class="auth-error">{{ $error }}</div>
            @endforeach
        </div>
    @endif

    <form method="POST" action="{{ route('password.update') }}">
        @csrf
        <input type="hidden" name="token" value="{{ $token }}">
        <div class="add-song-form-group">
            <label for="email">Email</label>
            <input type="email" id="email" name="email" value="{{ old('email', $email) }}" placeholder="you@example.com" required autocomplete="email">
        </div>
        <div class="add-song-form-group">
            <label for="password">New password</label>
            <input type="password" id="password" name="password" placeholder="At least 8 characters" required autofocus autocomplete="new-password">
        </div>
        <div class="add-song-form-group">
            <label for="password_confirmation">Confirm new password</label>
            <input type="password" id="password_confirmation" name="password_confirmation" placeholder="Repeat your password" required autocomplete="new-password">
        </div>
        <button type="submit" class="add-song-btn-save auth-submit">Reset password</button>
    </form>
@endsection
