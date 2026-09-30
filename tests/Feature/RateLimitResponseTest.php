<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/** A request that asks for JSON gets its errors as JSON, rate limits included. */
class RateLimitResponseTest extends TestCase
{
    use RefreshDatabase;

    public function test_search_rate_limit_answers_json_with_retry_after(): void
    {
        Http::fake(['*' => Http::response('<html></html>')]);
        $user = User::forceCreate([
            'name' => 'Searcher',
            'email' => uniqid().'@example.com',
            'password' => bcrypt('secret-password'),
            'email_verified_at' => now(),
        ]);

        for ($i = 0; $i < 70; $i++) {
            $this->actingAs($user)->postJson('/search-youtube', ['query' => "song {$i}"])->assertOk();
        }

        $res = $this->actingAs($user)->postJson('/search-youtube', ['query' => 'one too many']);
        $res->assertStatus(429);
        $this->assertStringContainsString('application/json', (string) $res->headers->get('Content-Type'));
        $this->assertGreaterThan(0, (int) $res->headers->get('Retry-After'));
    }

    public function test_page_requests_still_get_html_errors(): void
    {
        $this->get('/s/no-such-share-token')->assertNotFound()->assertHeader('Content-Type', 'text/html; charset=UTF-8');
    }
}
