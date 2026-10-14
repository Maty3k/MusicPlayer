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

        $this->get('/')->assertRedirect(route('login', ['ended' => 1]));
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

    public function test_the_session_handed_out_at_sign_in_is_already_bound_to_the_password(): void
    {
        // No request in between: the session is exactly what the sign-in
        // gave out, as a copy kept back from that moment would be.
        $user = $this->signedIn();

        User::findOrFail($user->id)->forceFill(['password' => 'changed-on-another-device'])->save();
        $this->nextRequest();

        $this->get('/')->assertRedirect(route('login', ['ended' => 1]));
        $this->assertGuest();
    }

    public function test_a_request_that_overlapped_the_change_does_not_sign_out_the_device_that_made_it(): void
    {
        $cookie = $this->app['auth']->guard()->getRecallerName();
        $oldCookie = $this->post('/member/start')->getCookie($cookie)?->getValue();
        $this->assertNotNull($oldCookie);
        $pin = session('member_card')['pin'];
        $this->get('/')->assertOk();
        $oldHash = session('password_hash_web');

        // Settings changes the PIN to a password and hands this device a
        // fresh "stay signed in" cookie...
        $change = $this->withCookie($cookie, $oldCookie)->postJson('/settings/password', [
            'current_password' => $pin,
            'password' => 'brand-new-password',
            'password_confirmation' => 'brand-new-password',
        ])->assertOk();
        $freshCookie = $change->getCookie($cookie)?->getValue();
        $this->assertNotNull($freshCookie);

        // ...while a slower request from before the change writes the old
        // fingerprint back into the session.
        session()->put('password_hash_web', $oldHash);
        $this->nextRequest();

        $this->withCookie($cookie, $freshCookie)->get('/')->assertOk();
        $this->assertAuthenticated();

        // The same stale session with the old cookie is someone who does not
        // have the new password: out.
        session()->put('password_hash_web', $oldHash);
        $this->nextRequest();
        $this->withCookie($cookie, $oldCookie)->get('/')->assertRedirect(route('login', ['ended' => 1]));
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
