@extends('layouts.auth')

@section('title', 'Register — Music Player')

@section('content')
    <h1 class="auth-heading">Create your account</h1>
    <p class="auth-sub">Start building your record collection</p>

    @if ($errors->any())
        <div class="auth-errors">
            @foreach ($errors->all() as $error)
                <div class="auth-error">{{ $error }}</div>
            @endforeach
        </div>
    @endif

    <form method="POST" action="{{ route('register') }}">
        @csrf
        <div class="add-song-form-group">
            <label for="name">Name</label>
            <input type="text" id="name" name="name" value="{{ old('name') }}" placeholder="Your name" required autofocus autocomplete="name">
        </div>
        <div class="add-song-form-group">
            <label for="email">Email</label>
            <input type="email" id="email" name="email" value="{{ old('email') }}" placeholder="you@example.com" required autocomplete="email">
        </div>
        <div class="add-song-form-group">
            <label for="password">Password</label>
            <input type="password" id="password" name="password" placeholder="At least 8 characters" required autocomplete="new-password">
        </div>
        <div class="add-song-form-group">
            <label for="password_confirmation">Confirm password</label>
            <input type="password" id="password_confirmation" name="password_confirmation" placeholder="Repeat your password" required autocomplete="new-password">
        </div>
        <button type="submit" class="add-song-btn-save auth-submit">Create account</button>
    </form>

    <div class="auth-alt">Already have an account? <a href="{{ route('login') }}">Log in</a></div>
@endsection
