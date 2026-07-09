<?php

namespace App\Models;

use Database\Factories\UserFactory;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

#[Fillable(['name', 'email', 'password', 'active_playlist_slug', 'recently_played'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable implements MustVerifyEmail
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'recently_played' => 'array',
        ];
    }

    public function playlists(): HasMany
    {
        return $this->hasMany(Playlist::class)->orderBy('position');
    }

    public function spotifyToken(): HasOne
    {
        return $this->hasOne(SpotifyToken::class);
    }

    /**
     * The playlist the player should show, falling back to the user's first
     * playlist (mirrors the legacy music.json activePlaylist fallback).
     */
    public function activePlaylist(): ?Playlist
    {
        $playlists = $this->playlists;
        if ($playlists->isEmpty()) {
            return null;
        }

        return $playlists->firstWhere('slug', $this->active_playlist_slug) ?? $playlists->first();
    }
}
