<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
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
