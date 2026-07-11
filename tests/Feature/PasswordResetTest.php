<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

class PasswordResetTest extends TestCase
{
    use RefreshDatabase;

    private function user(): User
    {
        return User::forceCreate([
            'name' => 'Curator',
            'email' => 'curator@example.com',
            'password' => bcrypt('old-password'),
            'email_verified_at' => now(),
        ]);
    }

    public function test_forgot_password_page_renders(): void
    {
        $this->get('/forgot-password')->assertOk()->assertSee('reset link');
    }

    public function test_reset_link_is_sent_to_known_email(): void
    {
        Notification::fake();
        $user = $this->user();

        $this->post('/forgot-password', ['email' => $user->email])
            ->assertSessionHas('status', 'reset-link-sent');

        Notification::assertSentTo($user, ResetPassword::class);
    }

    public function test_unknown_email_gets_the_same_response(): void
    {
        Notification::fake();

        $this->post('/forgot-password', ['email' => 'nobody@example.com'])
            ->assertSessionHas('status', 'reset-link-sent');

        Notification::assertNothingSent();
    }

    public function test_password_can_be_reset_with_valid_token(): void
    {
        Notification::fake();
        $user = $this->user();

        $this->post('/forgot-password', ['email' => $user->email]);

        Notification::assertSentTo($user, ResetPassword::class, function ($notification) use ($user) {
            $this->get('/reset-password/'.$notification->token.'?email='.$user->email)
                ->assertOk()->assertSee('new password');

            $this->post('/reset-password', [
                'token' => $notification->token,
                'email' => $user->email,
                'password' => 'brand-new-password',
                'password_confirmation' => 'brand-new-password',
            ])->assertRedirect(route('login'))
                ->assertSessionHas('status', 'password-reset');

            $this->assertTrue(Hash::check('brand-new-password', $user->fresh()->password));

            return true;
        });
    }

    public function test_invalid_token_is_rejected(): void
    {
        $user = $this->user();

        $this->post('/reset-password', [
            'token' => 'bogus-token',
            'email' => $user->email,
            'password' => 'brand-new-password',
            'password_confirmation' => 'brand-new-password',
        ])->assertSessionHasErrors('email');

        $this->assertTrue(Hash::check('old-password', $user->fresh()->password));
    }
}
