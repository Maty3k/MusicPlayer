<?php

namespace Tests\Feature;

use App\Models\Playlist;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ReorderTest extends TestCase
{
    use RefreshDatabase;

    private function user(): User
    {
        return User::forceCreate([
            'name' => 'Curator',
            'email' => uniqid().'@example.com',
            'password' => bcrypt('secret-password'),
            'email_verified_at' => now(),
        ]);
    }

    private function playlist(User $user, array $titles, int $currentIndex = 0): Playlist
    {
        $pl = $user->playlists()->create([
            'slug' => 'mix', 'name' => 'Mix', 'color' => '#d4a574',
            'current_index' => $currentIndex, 'source' => 'user', 'position' => 0,
        ]);
        $user->update(['active_playlist_slug' => 'mix']);
        foreach ($titles as $i => $t) {
            $pl->songs()->create(['position' => $i, 'title' => $t]);
        }

        return $pl;
    }

    private function reorder(User $user, array $order, ?string $slug = 'mix')
    {
        return $this->actingAs($user)
            ->postJson('/save-music', ['action' => 'reorder', 'playlist' => $slug, 'order' => $order])
            ->assertOk();
    }

    public function test_reorders_songs_and_follows_current_index(): void
    {
        $user = $this->user();
        $pl = $this->playlist($user, ['A', 'B', 'C'], currentIndex: 1); // B is current

        // New order: C, A, B
        $this->reorder($user, [2, 0, 1])->assertJson(['success' => true]);

        $titles = $pl->songs()->orderBy('position')->pluck('title')->all();
        $this->assertSame(['C', 'A', 'B'], $titles);
        // B was current (old index 1); it's now at position 2.
        $this->assertSame(2, (int) $pl->fresh()->current_index);
    }

    public function test_reorder_follows_the_pinned_cover(): void
    {
        $user = $this->user();
        $pl = $this->playlist($user, ['A', 'B', 'C']);
        $pl->update(['cover_song_index' => 2]); // pin C

        // New order C, A, B — C moves from index 2 to index 0.
        $this->reorder($user, [2, 0, 1])->assertJson(['success' => true]);

        $this->assertSame(0, (int) $pl->fresh()->cover_song_index);
    }

    public function test_rejects_a_non_permutation(): void
    {
        $user = $this->user();
        $pl = $this->playlist($user, ['A', 'B', 'C']);

        // Duplicate index — not a permutation.
        $this->reorder($user, [0, 0, 1])->assertJson(['success' => false]);
        // Wrong length.
        $this->reorder($user, [0, 1])->assertJson(['success' => false]);
        // Out of range.
        $this->reorder($user, [0, 1, 9])->assertJson(['success' => false]);

        // Order is untouched.
        $this->assertSame(['A', 'B', 'C'], $pl->songs()->orderBy('position')->pluck('title')->all());
    }

    public function test_cannot_reorder_another_users_playlist(): void
    {
        $me = $this->user();
        $other = $this->user();
        $this->playlist($other, ['X', 'Y']); // slug 'mix' belongs to $other

        // $me has no 'mix' playlist → invalid.
        $this->actingAs($me)
            ->postJson('/save-music', ['action' => 'reorder', 'playlist' => 'mix', 'order' => [1, 0]])
            ->assertOk()
            ->assertJson(['success' => false]);
    }

    public function test_requires_authentication(): void
    {
        $this->postJson('/save-music', ['action' => 'reorder', 'playlist' => 'mix', 'order' => [0]])
            ->assertRedirect();
    }
}
