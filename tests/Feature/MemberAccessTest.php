<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Testing\TestResponse;
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

    public function test_a_new_pin_has_six_digits(): void
    {
        $this->post('/member/start');

        $this->assertMatchesRegularExpression('/^\d{6}$/', session('member_card')['pin']);
    }

    public function test_a_member_number_locks_after_five_wrong_pins(): void
    {
        $user = $this->member(42);

        for ($i = 0; $i < 5; $i++) {
            $this->tryPin('42', '9999')->assertSessionHasErrors('member_number');
            $this->assertStringContainsString("don't match", $this->loginError());
        }

        // Locked: even the right PIN is refused, or the guessing could go on
        $this->tryPin('42', '0137')->assertRedirect('/login');
        $this->assertStringStartsWith('Too many wrong PINs. Try again in ', $this->loginError());
        $this->assertGuest();

        $this->travel(16)->minutes();

        $this->tryPin('42', '0137')->assertRedirect(route('player'));
        $this->assertAuthenticatedAs($user);
    }

    public function test_a_lock_holds_one_member_number_only(): void
    {
        $this->member(42);
        $other = $this->member(43, '2468');

        for ($i = 0; $i < 5; $i++) {
            $this->tryPin('42', '9999');
        }

        $this->tryPin('43', '2468')->assertRedirect(route('player'));
        $this->assertAuthenticatedAs($other);
    }

    public function test_the_right_pin_starts_the_count_again(): void
    {
        $user = $this->member(42);

        for ($i = 0; $i < 4; $i++) {
            $this->tryPin('42', '9999');
        }
        $this->tryPin('42', '0137')->assertRedirect(route('player'));
        auth()->logout();
        $this->travel(2)->minutes();

        // Four more: nine wrong in all, but only four since the right one
        for ($i = 0; $i < 4; $i++) {
            $this->tryPin('42', '9999');
        }
        $this->tryPin('42', '0137')->assertRedirect(route('player'));
        $this->assertAuthenticatedAs($user);
    }

    public function test_a_number_nobody_has_locks_the_same_way(): void
    {
        for ($i = 0; $i < 5; $i++) {
            $this->tryPin('999', '1234');
            $this->assertStringContainsString("don't match", $this->loginError());
        }

        // The same answer a real member's number gives: a lock tells nothing
        $this->tryPin('999', '1234');
        $this->assertStringStartsWith('Too many wrong PINs. Try again in ', $this->loginError());
    }

    public function test_twenty_wrong_pins_lock_a_member_number_for_the_day(): void
    {
        $user = $this->member(42);

        // Five at a time, waiting out the short lock in between
        for ($round = 0; $round < 4; $round++) {
            for ($i = 0; $i < 5; $i++) {
                $this->tryPin('42', '9999');
                $this->assertStringContainsString("don't match", $this->loginError());
            }
            $this->travel(16)->minutes();
        }

        $this->tryPin('42', '0137')->assertRedirect('/login');
        $this->assertStringStartsWith('Too many wrong PINs. Try again in ', $this->loginError());
        $this->assertStringEndsWith('hours.', $this->loginError());
        $this->assertGuest();

        $this->travel(24)->hours();

        $this->tryPin('42', '0137')->assertRedirect(route('player'));
        $this->assertAuthenticatedAs($user);
    }

    public function test_one_address_cannot_spread_wrong_pins_over_many_numbers(): void
    {
        $this->member(42);

        // Thirty wrong PINs, each for a different number. (Ten a minute is
        // all the route's own throttle lets through.)
        for ($round = 0; $round < 3; $round++) {
            for ($i = 0; $i < 10; $i++) {
                $this->tryPin((string) (100 + $round * 10 + $i), '9999');
                $this->assertStringContainsString("don't match", $this->loginError());
            }
            $this->travel(61)->seconds();
        }

        $this->tryPin('42', '0137')->assertRedirect('/login');
        $this->assertStringStartsWith('Too many wrong PINs. Try again in ', $this->loginError());
        $this->assertGuest();
    }

    private function member(int $number, string $pin = '0137'): User
    {
        return User::forceCreate([
            'name' => 'Member',
            'member_number' => $number,
            'password' => bcrypt($pin),
        ]);
    }

    private function tryPin(string $number, string $pin): TestResponse
    {
        return $this->from('/login')->post('/member/login', ['member_number' => $number, 'pin' => $pin]);
    }

    /** What the login page would show after the last attempt. */
    private function loginError(): string
    {
        $errors = session('errors');

        return $errors ? (string) $errors->first('member_number') : '';
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
