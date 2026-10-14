<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

/**
 * What stays behind in a browser: the page with a new member's PIN is never
 * kept as the offline copy, logging out wipes what the app stored on the
 * device, and every answer carries the basic protective headers.
 */
class DeviceIsLeftCleanTest extends TestCase
{
    use RefreshDatabase;

    public function test_the_page_showing_a_new_pin_is_not_to_be_stored(): void
    {
        $this->post('/member/start');

        // The service worker skips a no-store page (public/sw.js)
        $first = $this->get('/')->assertOk()->assertSee('memberWelcomeModal');
        $this->assertStringContainsString('no-store', (string) $first->headers->get('Cache-Control'));

        $second = $this->get('/')->assertOk()->assertDontSee('memberWelcomeModal');
        $this->assertStringNotContainsString('no-store', (string) $second->headers->get('Cache-Control'));
    }

    public function test_logging_out_tells_the_browser_to_wipe_what_the_app_stored(): void
    {
        $this->post('/member/start');

        $this->post('/logout')
            ->assertRedirect(route('login'))
            ->assertHeader('Clear-Site-Data', '"cache", "storage"');
        $this->assertGuest();
    }

    public function test_every_answer_carries_the_protective_headers(): void
    {
        $user = User::forceCreate([
            'name' => 'Listener',
            'email' => 'listener@example.com',
            'password' => bcrypt('secret-password'),
            'email_verified_at' => now(),
        ]);

        foreach ([
            $this->get('/login'),
            $this->actingAs($user)->get('/'),
            $this->actingAs($user)->postJson('/save-music', ['action' => 'stats']),
        ] as $response) {
            $response->assertOk()
                ->assertHeader('X-Content-Type-Options', 'nosniff')
                ->assertHeader('X-Frame-Options', 'SAMEORIGIN')
                ->assertHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        }
    }

    public function test_a_limit_reached_by_a_form_gets_a_page_that_says_how_long_to_wait(): void
    {
        for ($i = 0; $i < 5; $i++) {
            $this->post('/member/start')->assertRedirect(route('player'));
            auth()->logout();
        }

        $this->post('/member/start')
            ->assertStatus(429)
            ->assertSee('Too many tries.')
            ->assertSee('Try again in');
    }

    public function test_the_verification_link_points_at_the_site_whatever_host_asked_for_it(): void
    {
        Notification::fake();
        config(['app.url' => 'https://music.example']);

        $this->withHeaders(['X-Forwarded-Host' => 'evil.example'])->post('/register', [
            'name' => 'New',
            'email' => 'new@example.com',
            'password' => 'brand-new-password',
            'password_confirmation' => 'brand-new-password',
        ]);

        $user = User::where('email', 'new@example.com')->firstOrFail();
        Notification::assertSentTo($user, VerifyEmail::class, function ($notification) use ($user) {
            $link = $notification->toMail($user)->actionUrl;

            return str_starts_with($link, 'https://music.example/email/verify/'.$user->id.'/')
                && ! str_contains($link, 'evil.example');
        });
    }

    public function test_an_email_address_can_only_be_attached_a_few_times_a_day(): void
    {
        $member = User::forceCreate([
            'name' => 'Member',
            'member_number' => 42,
            'password' => bcrypt('0137'),
        ]);

        for ($i = 0; $i < 5; $i++) {
            $this->actingAs($member)->postJson('/settings/email', [
                'email' => "address{$i}@example.com",
                'current_password' => '0137',
            ])->assertOk();
            $this->travel(2)->minutes();
        }

        $this->actingAs($member)->postJson('/settings/email', [
            'email' => 'one-too-many@example.com',
            'current_password' => '0137',
        ])->assertStatus(429);
        $this->assertSame('address4@example.com', $member->fresh()->email);
    }
}
