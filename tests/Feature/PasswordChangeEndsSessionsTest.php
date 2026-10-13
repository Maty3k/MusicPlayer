<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A changed password or PIN signs every other device out; the device that
 * made the change stays in. (Before, a session that was open once outlived
 * any password change or reset for as long as it stayed in use.)
 */
class PasswordChangeEndsSessionsTest extends TestCase
{
    use RefreshDatabase;

    private function signedIn(): User
    {
        $user = User::forceCreate([
            'name' => 'Listener',
            'email' => 'listener@example.com',
            'password' => bcrypt('old-password'),
            'email_verified_at' => now(),
        ]);

        $this->post('/login', ['email' => $user->email, 'password' => 'old-password'])
            ->assertRedirect(route('player'));

        return $user;
    }

    /** The next request reads the account afresh, as a real one would. */
    private function nextRequest(): void
    {
        $this->app['auth']->forgetGuards();
    }

    public function test_a_password_changed_elsewhere_ends_this_session(): void
    {
        $user = $this->signedIn();
        $this->get('/')->assertOk();

        User::findOrFail($user->id)->forceFill(['password' => 'changed-on-another-device'])->save();
        $this->nextRequest();

        $this->get('/')->assertRedirect(route('login'));
        $this->assertGuest();
    }

    public function test_changing_your_own_password_keeps_this_device_signed_in(): void
    {
        $user = $this->signedIn();
        $this->get('/')->assertOk();

        $this->postJson('/settings/password', [
            'current_password' => 'old-password',
            'password' => 'brand-new-password',
            'password_confirmation' => 'brand-new-password',
        ])->assertOk()->assertJson(['success' => true]);
        $this->nextRequest();

        $this->get('/')->assertOk();
        $this->assertAuthenticatedAs($user);
    }

    public function test_a_session_is_not_thrown_out_when_nothing_changed(): void
    {
        $this->signedIn();

        $this->get('/')->assertOk();
        $this->nextRequest();
        $this->get('/')->assertOk();
        $this->assertAuthenticated();
    }
}
