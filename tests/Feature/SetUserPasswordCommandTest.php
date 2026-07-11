<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class SetUserPasswordCommandTest extends TestCase
{
    use RefreshDatabase;

    public function test_sets_the_password_for_an_existing_user(): void
    {
        $user = User::forceCreate([
            'name' => 'Listener',
            'email' => 'listener@example.com',
            'password' => bcrypt('old-password'),
            'email_verified_at' => now(),
        ]);

        $this->artisan('user:password', [
            'email' => 'Listener@Example.com',
            'password' => 'fresh-password',
        ])->assertExitCode(0);

        $this->assertTrue(Hash::check('fresh-password', $user->fresh()->password));

        $this->post('/login', [
            'email' => 'listener@example.com',
            'password' => 'fresh-password',
        ])->assertRedirect(route('player'));
    }

    public function test_rejects_unknown_users_and_short_passwords(): void
    {
        $this->artisan('user:password', [
            'email' => 'nobody@example.com',
            'password' => 'long-enough-pass',
        ])->assertExitCode(1);

        $user = User::forceCreate([
            'name' => 'Listener',
            'email' => 'listener@example.com',
            'password' => bcrypt('old-password'),
        ]);

        $this->artisan('user:password', [
            'email' => 'listener@example.com',
            'password' => 'short',
        ])->assertExitCode(1);

        $this->assertTrue(Hash::check('old-password', $user->fresh()->password));
    }
}
