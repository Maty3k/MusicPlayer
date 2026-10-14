@extends('layouts.auth')

@section('title', 'Too many tries — Music Player')

{{-- A limit reached by a form (sign-up, log in, the verification mail).
     Calls made by the player itself get JSON instead (bootstrap/app.php). --}}
@section('content')
    @php
        $retryAfter = (int) ($exception->getHeaders()['Retry-After'] ?? 60);
        $minutes = max(1, (int) ceil($retryAfter / 60));
        $wait = $minutes < 90 ? ($minutes === 1 ? '1 minute' : $minutes.' minutes') : ((int) ceil($minutes / 60)).' hours';
    @endphp
    <h1 class="auth-heading">Too many tries.</h1>
    <p class="auth-sub">That was done too often in a short time. Try again in {{ $wait }}.</p>
    <p class="auth-alt"><a href="{{ url('/') }}">Back to the start</a></p>
@endsection
