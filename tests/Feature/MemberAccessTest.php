<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class MemberAccessTest extends TestCase
{
    use RefreshDatabase;

    public function test_start_deals_a_member_account_and_logs_in(): void
    {
        $response = $this->post('/member/start');

        $response->assertRedirect(route('player'));
        $response->assertSessionHas('member_card');

        $user = User::firstOrFail();
        $this->assertAuthenticatedAs($user);
        $this->assertSame(1, $user->member_number);
        $this->assertNull($user->email);

        $card = session('member_card');
        $this->assertSame('#0001', $card['number']);
        $this->assertTrue(Hash::check($card['pin'], $user->password));
    }

    public function test_member_numbers_are_sequential(): void
    {
        $this->post('/member/start');
        auth()->logout();
        $this->post('/member/start');

        $this->assertSame([1, 2], User::orderBy('member_number')->pluck('member_number')->all());
    }

    public function test_member_can_log_in_with_number_and_pin(): void
    {
        $user = User::forceCreate([
            'name' => 'Member',
            'member_number' => 42,
            'password' => bcrypt('0137'),
        ]);

        // Card-formatted number is accepted too
        $this->post('/member/login', ['member_number' => '#0042', 'pin' => '0137'])
            ->assertRedirect(route('player'));
        $this->assertAuthenticatedAs($user);
    }

    public function test_wrong_pin_is_rejected(): void
    {
        User::forceCreate([
            'name' => 'Member',
            'member_number' => 42,
            'password' => bcrypt('0137'),
        ]);

        $this->from('/login')->post('/member/login', ['member_number' => '42', 'pin' => '9999'])
            ->assertRedirect('/login')
            ->assertSessionHasErrors('member_number');
        $this->assertGuest();
    }

    public function test_member_skips_the_email_verification_wall(): void
    {
        $this->post('/member/start');

        // No email, no email_verified_at — the player must still open
        $this->get('/')->assertOk()->assertSee('memberWelcomeModal');
    }

    public function test_member_card_only_shows_on_the_first_load(): void
    {
        $this->post('/member/start');

        $this->get('/')->assertOk()->assertSee('memberWelcomeModal');
        $this->get('/')->assertOk()->assertDontSee('memberWelcomeModal');
    }

    public function test_member_can_attach_an_email(): void
    {
        $user = User::forceCreate([
            'name' => 'Member',
            'member_number' => 42,
            'password' => bcrypt('0137'),
        ]);

        $this->actingAs($user)->postJson('/settings/email', [
            'email' => 'claimed@example.com',
            'current_password' => '0137',
        ])->assertOk()->assertJson(['success' => true]);

        $user->refresh();
        $this->assertSame('claimed@example.com', $user->email);
        // Still no verification wall: the member number vouches for the account
        $this->actingAs($user)->get('/')->assertOk();

        // The attached email logs in with the same secret
        auth()->logout();
        $this->post('/login', ['email' => 'claimed@example.com', 'password' => '0137'])
            ->assertRedirect(route('player'));
    }

    public function test_attaching_an_email_requires_the_current_pin(): void
    {
        $user = User::forceCreate([
            'name' => 'Member',
            'member_number' => 42,
            'password' => bcrypt('0137'),
        ]);

        $this->actingAs($user)->postJson('/settings/email', [
            'email' => 'thief@example.com',
            'current_password' => '9999',
        ])->assertUnprocessable();

        $this->assertNull($user->refresh()->email);
    }

    public function test_taken_email_cannot_be_attached(): void
    {
        User::forceCreate([
            'name' => 'Existing',
            'email' => 'taken@example.com',
            'password' => bcrypt('long-password'),
            'email_verified_at' => now(),
        ]);
        $member = User::forceCreate([
            'name' => 'Member',
            'member_number' => 42,
            'password' => bcrypt('0137'),
        ]);

        $this->actingAs($member)->postJson('/settings/email', [
            'email' => 'taken@example.com',
            'current_password' => '0137',
        ])->assertUnprocessable();
    }

    public function test_email_registration_still_works(): void
    {
        $this->post('/register', [
            'name' => 'Classic',
            'email' => 'classic@example.com',
            'password' => 'brand-new-password',
            'password_confirmation' => 'brand-new-password',
        ])->assertRedirect(route('verification.notice'));

        $this->assertNull(User::firstOrFail()->member_number);
    }
}
