<?php

namespace Tests\Feature;

use App\Models\Playlist;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SharePlaylistTest extends TestCase
{
    use RefreshDatabase;

    private function user(): User
    {
        return User::forceCreate([
            'name' => 'Sharer',
            'email' => uniqid().'@example.com',
            'password' => bcrypt('secret-password'),
            'email_verified_at' => now(),
        ]);
    }

    private function playlist(User $user, array $songs = []): Playlist
    {
        $pl = $user->playlists()->create([
            'slug' => 'mix', 'name' => 'Road Trip', 'color' => '#e85d75',
            'current_index' => 0, 'source' => 'user', 'position' => 0,
        ]);
        foreach ($songs as $i => $s) {
            $pl->songs()->create(array_merge(['position' => $i, 'title' => $s['title'] ?? 'T'], $s));
        }

        return $pl;
    }

    public function test_share_generates_a_token(): void
    {
        $user = $this->user();
        $pl = $this->playlist($user);

        $res = $this->actingAs($user)
            ->postJson('/save-music', ['action' => 'share', 'playlist' => 'mix'])
            ->assertOk()
            ->assertJson(['success' => true]);

        $token = $res->json('token');
        $this->assertNotEmpty($token);
        $this->assertSame($token, $pl->fresh()->share_token);
    }

    public function test_public_page_renders_read_only_for_guests(): void
    {
        $user = $this->user();
        // Set the token directly so the GET below is a genuine guest request.
        $pl = $this->playlist($user, [
            ['title' => 'Thunder', 'artist' => 'AC/DC', 'cover' => 'https://img.example/x.jpg'],
        ]);
        $pl->update(['share_token' => 'guestviewtoken']);

        $this->get('/s/guestviewtoken')
            ->assertOk()
            ->assertSee('Road Trip')
            ->assertSee('Thunder')
            ->assertSee('Save this playlist &middot; sign up or log in', false);
    }

    public function test_sharing_twice_returns_the_same_token(): void
    {
        $user = $this->user();
        $this->playlist($user);
        $t1 = $this->actingAs($user)->postJson('/save-music', ['action' => 'share', 'playlist' => 'mix'])->json('token');
        $t2 = $this->actingAs($user)->postJson('/save-music', ['action' => 'share', 'playlist' => 'mix'])->json('token');
        $this->assertSame($t1, $t2);
    }

    public function test_unknown_and_revoked_tokens_404(): void
    {
        $this->get('/s/nope123')->assertNotFound();

        $user = $this->user();
        $this->playlist($user);
        $token = $this->actingAs($user)->postJson('/save-music', ['action' => 'share', 'playlist' => 'mix'])->json('token');
        $this->get('/s/'.$token)->assertOk();

        // Revoke → old link 404s.
        $this->actingAs($user)->postJson('/save-music', ['action' => 'unshare', 'playlist' => 'mix'])->assertJson(['success' => true]);
        $this->get('/s/'.$token)->assertNotFound();
    }

    public function test_public_page_hides_private_media_covers(): void
    {
        $user = $this->user();
        $this->playlist($user, [
            ['title' => 'Local Song', 'cover' => '/media/deadbeef-0000-0000-0000-000000000000.jpg'],
        ]);
        $token = $this->actingAs($user)->postJson('/save-music', ['action' => 'share', 'playlist' => 'mix'])->json('token');

        $this->get('/s/'.$token)->assertOk()->assertDontSee('/media/deadbeef', false);
    }

    public function test_authed_user_can_add_a_shared_playlist_without_private_audio(): void
    {
        $owner = $this->user();
        $this->playlist($owner, [
            ['title' => 'Keeper', 'artist' => 'X', 'youtube_id' => 'aaaaaaaaaaa', 'mp3_url' => '/media/secret.mp3', 'cover' => 'https://img/x.jpg'],
        ]);
        $token = $this->actingAs($owner)->postJson('/save-music', ['action' => 'share', 'playlist' => 'mix'])->json('token');

        $me = $this->user();
        $this->actingAs($me)->post('/s/'.$token.'/add')->assertRedirect('/');

        $copied = $me->playlists()->where('name', 'Road Trip')->firstOrFail();
        $song = $copied->songs()->firstOrFail();
        $this->assertSame('Keeper', $song->title);
        $this->assertSame('aaaaaaaaaaa', $song->youtube_id);
        // The owner's uploaded audio is never copied.
        $this->assertSame('', (string) $song->mp3_url);
    }

    public function test_add_shows_a_success_flash_on_the_player(): void
    {
        $owner = $this->user();
        $pl = $this->playlist($owner, [['title' => 'Keeper']]);
        $pl->update(['share_token' => 'flashtok']);

        $me = $this->user();
        $this->actingAs($me)
            ->followingRedirects()
            ->post('/s/flashtok/add')
            ->assertOk()
            ->assertSee('app-flash', false)
            ->assertSee('to your library', false);
    }

    public function test_adding_requires_authentication(): void
    {
        $owner = $this->user();
        $pl = $this->playlist($owner);
        // Set the token directly so the POST below is a genuine guest request.
        $pl->update(['share_token' => 'guestaddtoken']);

        $this->post('/s/guestaddtoken/add')->assertRedirect('/login');
    }

    public function test_add_blanks_a_crafted_youtube_id(): void
    {
        $owner = $this->user();
        $pl = $this->playlist($owner, [['title' => 'Bad', 'youtube_id' => '"><script>']]);
        $pl->update(['share_token' => 'craftedtok']);

        $me = $this->user();
        $this->actingAs($me)->post('/s/craftedtok/add')->assertRedirect('/');

        $copied = $me->playlists()->where('name', 'Road Trip')->firstOrFail();
        $this->assertSame('', (string) $copied->songs()->firstOrFail()->youtube_id);
    }

    public function test_unverified_user_sees_login_cta_not_add_button(): void
    {
        $owner = $this->user();
        $pl = $this->playlist($owner);
        $pl->update(['share_token' => 'unverifiedtok']);

        $unverified = User::forceCreate([
            'name' => 'Unverified',
            'email' => uniqid().'@example.com',
            'password' => bcrypt('secret-password'),
            'email_verified_at' => null,
        ]);

        $this->actingAs($unverified)->get('/s/unverifiedtok')
            ->assertOk()
            ->assertSee('Save this playlist &middot; sign up or log in', false)
            ->assertDontSee('Add to my library');
    }

    public function test_cannot_share_another_users_playlist(): void
    {
        $me = $this->user();
        $other = $this->user();
        $this->playlist($other); // slug 'mix' belongs to $other

        $this->actingAs($me)
            ->postJson('/save-music', ['action' => 'share', 'playlist' => 'mix'])
            ->assertJson(['success' => false]);
    }
}
