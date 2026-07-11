<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class CreateUserCommandTest extends TestCase
{
    use RefreshDatabase;

    public function test_creates_a_verified_user_with_favorites_playlist(): void
    {
        $this->artisan('user:create', [
            'email' => 'Listener@Example.com',
            'name' => 'Listener',
            'password' => 'listen-to-records',
        ])->assertExitCode(0);

        $user = User::where('email', 'listener@example.com')->firstOrFail();
        $this->assertNotNull($user->email_verified_at);
        $this->assertTrue(Hash::check('listen-to-records', $user->password));
        $this->assertSame('favorites', $user->active_playlist_slug);
        $this->assertSame('Favorites', $user->activePlaylist()->name);

        // Account can actually log in through the web flow
        $this->post('/login', [
            'email' => 'listener@example.com',
            'password' => 'listen-to-records',
        ])->assertRedirect(route('player'));
    }

    public function test_rejects_duplicates_and_short_passwords(): void
    {
        User::forceCreate([
            'name' => 'Existing',
            'email' => 'taken@example.com',
            'password' => bcrypt('some-password'),
        ]);

        $this->artisan('user:create', [
            'email' => 'taken@example.com',
            'name' => 'Dupe',
            'password' => 'long-enough-pass',
        ])->assertExitCode(1);

        $this->artisan('user:create', [
            'email' => 'new@example.com',
            'name' => 'Shorty',
            'password' => 'short',
        ])->assertExitCode(1);

        $this->assertNull(User::where('email', 'new@example.com')->first());
    }
}
