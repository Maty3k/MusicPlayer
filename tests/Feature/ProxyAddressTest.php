<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * Behind Laravel Cloud's proxy the visitor's address is the X-Forwarded-For
 * entry the proxy added, never one the visitor wrote in front of it: every
 * per-address limit (PIN tries, new accounts, reset mails) counts by it.
 */
class ProxyAddressTest extends TestCase
{
    use RefreshDatabase;

    /** A request that came through the proxy, with a made-up entry in front of the real one. */
    private function throughTheProxy(string $madeUp): static
    {
        return $this->withServerVariables(['REMOTE_ADDR' => '10.0.0.2'])
            ->withHeader('X-Forwarded-For', $madeUp.', 81.2.69.160')
            ->withHeader('X-Forwarded-Proto', 'https');
    }

    public function test_the_address_is_the_entry_the_proxy_added_and_https_still_counts(): void
    {
        Route::get('/test/visitor', fn (Request $request) => ['ip' => $request->ip(), 'secure' => $request->isSecure()]);

        $this->throughTheProxy('6.6.6.6')->get('/test/visitor')
            ->assertExactJson(['ip' => '81.2.69.160', 'secure' => true]);
    }

    public function test_made_up_entries_do_not_reset_the_new_account_limit(): void
    {
        for ($i = 1; $i <= 5; $i++) {
            $this->throughTheProxy("6.6.6.$i")->post('/member/start')->assertRedirect();
            $this->app['auth']->forgetGuards();
            $this->flushSession();
        }

        $this->throughTheProxy('6.6.6.6')->post('/member/start')->assertStatus(429);
        $this->assertSame(5, User::count());
    }
}
