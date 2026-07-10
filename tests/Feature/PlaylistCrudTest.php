<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class PlaylistCrudTest extends TestCase
{
    use RefreshDatabase;

    private function verifiedUser(): User
    {
        return User::forceCreate([
            'name' => 'Curator',
            'email' => uniqid().'@example.com',
            'password' => bcrypt('secret-password'),
            'email_verified_at' => now(),
        ]);
    }

    public function test_create_switch_and_delete_playlist(): void
    {
        Storage::fake('local');
        $user = $this->verifiedUser();

        // Create
        $res = $this->actingAs($user)->postJson('/save-music', [
            'action' => 'createPlaylist', 'name' => 'Late Night Mix', 'color' => '#7eb8da',
        ]);
        $res->assertOk()->assertJson(['success' => true]);
        $slug = $res->json('playlistId');
        $this->assertMatchesRegularExpression('/^pl-[a-z0-9]{10}$/', $slug);
        $this->assertSame('Late Night Mix', $res->json('playlist.name'));

        // Switch to it and add a song (with a fake uploaded file to GC later)
        Storage::disk('local')->put("music/{$user->id}/11111111-1111-1111-1111-111111111111.mp3", 'x');
        $this->actingAs($user)->postJson('/save-music', [
            'action' => 'switchPlaylist', 'playlist' => $slug,
        ])->assertJson(['success' => true]);
        $this->actingAs($user)->postJson('/save-music', [
            'action' => 'add',
            'song' => ['title' => 'Track', 'mp3_url' => '/media/11111111-1111-1111-1111-111111111111.mp3'],
        ])->assertJson(['success' => true]);

        // Delete: playlist + songs gone, upload GC'd, active slug repointed
        $this->actingAs($user)->postJson('/save-music', [
            'action' => 'deletePlaylist', 'playlist' => $slug,
        ])->assertJson(['success' => true]);

        $this->assertDatabaseMissing('playlists', ['slug' => $slug, 'user_id' => $user->id]);
        $this->assertDatabaseMissing('songs', ['title' => 'Track']);
        Storage::disk('local')->assertMissing("music/{$user->id}/11111111-1111-1111-1111-111111111111.mp3");
        $this->assertNotSame($slug, $user->fresh()->active_playlist_slug);
        $this->assertNotContains($slug, $user->fresh()->recently_played ?? []);
    }

    public function test_create_rejects_bad_names_and_delete_rejects_unknown(): void
    {
        $user = $this->verifiedUser();

        $this->actingAs($user)->postJson('/save-music', [
            'action' => 'createPlaylist', 'name' => '',
        ])->assertJson(['success' => false]);

        $this->actingAs($user)->postJson('/save-music', [
            'action' => 'createPlaylist', 'name' => str_repeat('x', 31),
        ])->assertJson(['success' => false]);

        $this->actingAs($user)->postJson('/save-music', [
            'action' => 'deletePlaylist', 'playlist' => 'does-not-exist',
        ])->assertJson(['success' => false]);
    }
}
