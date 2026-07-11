<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ImportMusicJsonTest extends TestCase
{
    use RefreshDatabase;

    private function user(array $attributes = []): User
    {
        return User::forceCreate([
            'name' => 'Curator',
            'email' => uniqid().'@example.com',
            'password' => bcrypt('secret-password'),
            'email_verified_at' => now(),
            ...$attributes,
        ]);
    }

    private function fixture(array $playlists): string
    {
        $path = tempnam(sys_get_temp_dir(), 'music-json-');
        file_put_contents($path, json_encode(['playlists' => $playlists]));

        return $path;
    }

    public function test_import_replaces_library_and_add_refuses_to(): void
    {
        $user = $this->user();
        $path = $this->fixture([
            'mix' => ['name' => 'Mix', 'songs' => [['title' => 'One', 'artist' => 'A', 'youtube_id' => 'aaaaaaaaaaa']]],
        ]);

        $this->artisan('music:import', ['email' => $user->email, 'path' => $path])
            ->assertSuccessful();
        $this->assertSame('mix', $user->fresh()->active_playlist_slug);
        $this->assertDatabaseHas('songs', ['title' => 'One']);

        // A second plain import refuses without --force…
        $this->artisan('music:import', ['email' => $user->email, 'path' => $path])
            ->assertFailed();

        // …and --add with --force is rejected outright.
        $this->artisan('music:import', ['email' => $user->email, 'path' => $path, '--add' => true, '--force' => true])
            ->assertFailed();
    }

    public function test_add_keeps_existing_playlists_and_active_slug(): void
    {
        $user = $this->user();
        $existing = $user->playlists()->create([
            'slug' => 'kept', 'name' => 'Kept', 'color' => '#d4a574',
            'current_index' => 0, 'source' => 'user', 'position' => 0,
        ]);
        $existing->songs()->create(['position' => 0, 'title' => 'Old', 'artist' => 'A']);
        $user->active_playlist_slug = 'kept';
        $user->recently_played = ['kept'];
        $user->save();

        $path = $this->fixture([
            'new-pl' => ['name' => 'New', 'songs' => [['title' => 'Fresh', 'artist' => 'B', 'youtube_id' => 'bbbbbbbbbbb']]],
        ]);

        $this->artisan('music:import', ['email' => $user->email, 'path' => $path, '--add' => true])
            ->assertSuccessful();

        $user->refresh();
        $this->assertSame('kept', $user->active_playlist_slug);
        $this->assertSame(['kept'], $user->recently_played);
        $this->assertDatabaseHas('songs', ['title' => 'Old']);
        $this->assertDatabaseHas('songs', ['title' => 'Fresh']);

        // The added playlist sorts after the existing ones.
        $added = $user->playlists()->where('slug', 'new-pl')->first();
        $this->assertSame(1, $added->position);

        // Re-adding the same slug is a collision, not a wipe.
        $this->artisan('music:import', ['email' => $user->email, 'path' => $path, '--add' => true])
            ->assertFailed();
        $this->assertSame(1, $user->playlists()->where('slug', 'new-pl')->count());
    }

    public function test_force_replaces_library_even_with_overlapping_slug(): void
    {
        $user = $this->user();
        $existing = $user->playlists()->create([
            'slug' => 'mix', 'name' => 'Old Mix', 'color' => '#d4a574',
            'current_index' => 0, 'source' => 'user', 'position' => 0,
        ]);
        $existing->songs()->create(['position' => 0, 'title' => 'Old', 'artist' => 'A']);
        $user->active_playlist_slug = 'mix';
        $user->recently_played = ['mix'];
        $user->save();

        // Same slug as the existing playlist — replace must not collide.
        $path = tempnam(sys_get_temp_dir(), 'music-json-');
        file_put_contents($path, json_encode([
            'activePlaylist' => 'chill',
            'recentlyPlayed' => ['chill', 'mix'],
            'playlists' => [
                'mix' => ['name' => 'New Mix', 'songs' => [['title' => 'New', 'artist' => 'B', 'youtube_id' => 'ccccccccccc']]],
                'chill' => ['name' => 'Chill', 'songs' => []],
            ],
        ]));

        $this->artisan('music:import', ['email' => $user->email, 'path' => $path, '--force' => true])
            ->assertSuccessful();

        $user->refresh();
        $this->assertSame(2, $user->playlists()->count());
        $this->assertDatabaseMissing('songs', ['title' => 'Old']);
        $this->assertDatabaseHas('songs', ['title' => 'New']);
        $this->assertSame('New Mix', $user->playlists()->where('slug', 'mix')->first()->name);
        $this->assertSame('chill', $user->active_playlist_slug);
        $this->assertSame(['chill', 'mix'], $user->recently_played);
    }

    public function test_add_leaves_null_active_slug_alone_when_playlists_exist(): void
    {
        // Reachable app state: last playlist deleted (slug nulled), then a song
        // added (auto-creates 'favorites' without setting the active slug).
        // --add must not steal the first-playlist fallback.
        $user = $this->user();
        $user->playlists()->create([
            'slug' => 'favorites', 'name' => 'Favorites', 'color' => '#d4a574',
            'current_index' => 0, 'source' => 'user', 'position' => 0,
        ]);

        $path = $this->fixture([
            'imported' => ['name' => 'Imported', 'songs' => []],
        ]);

        $this->artisan('music:import', ['email' => $user->email, 'path' => $path, '--add' => true])
            ->assertSuccessful();
        $this->assertNull($user->fresh()->active_playlist_slug);
    }

    public function test_add_sets_active_slug_for_user_without_one(): void
    {
        $user = $this->user();
        $path = $this->fixture([
            'first' => ['name' => 'First', 'songs' => []],
        ]);

        $this->artisan('music:import', ['email' => $user->email, 'path' => $path, '--add' => true])
            ->assertSuccessful();
        $this->assertSame('first', $user->fresh()->active_playlist_slug);
    }

    public function test_bundled_my_playlist_1_file_imports_cleanly(): void
    {
        $user = $this->user();

        $this->artisan('music:import', [
            'email' => $user->email,
            'path' => 'database/legacy/my-playlist-1.json',
            '--add' => true,
        ])->assertSuccessful();

        $playlist = $user->playlists()->where('slug', 'my-playlist-1')->first();
        $this->assertNotNull($playlist);
        $this->assertSame('My playlist #1', $playlist->name);
        $this->assertSame(38, $playlist->songs()->count());
        $this->assertSame(0, $playlist->songs()->where('youtube_id', '')->count());
    }

    public function test_user_verify_marks_email_verified(): void
    {
        $user = $this->user(['email_verified_at' => null]);
        $this->assertFalse($user->hasVerifiedEmail());

        $this->artisan('user:verify', ['email' => $user->email])->assertSuccessful();
        $this->assertTrue($user->fresh()->hasVerifiedEmail());

        // Idempotent, and unknown users fail loudly.
        $this->artisan('user:verify', ['email' => $user->email])->assertSuccessful();
        $this->artisan('user:verify', ['email' => 'nobody@example.com'])->assertFailed();
    }
}
