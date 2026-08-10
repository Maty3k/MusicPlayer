<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class RecommendationsTest extends TestCase
{
    use RefreshDatabase;

    private function verifiedUser(): User
    {
        return User::forceCreate([
            'name' => 'Listener',
            'email' => uniqid().'@example.com',
            'password' => bcrypt('secret-password'),
            'email_verified_at' => now(),
        ]);
    }

    private function userWithLibrary(): User
    {
        $user = $this->verifiedUser();
        $playlist = $user->playlists()->create([
            'slug' => 'faves', 'name' => 'Faves', 'color' => '#d4a574',
            'current_index' => 0, 'source' => 'user', 'position' => 0,
        ]);
        foreach ([
            ['No Pole', 'Don Toliver'],
            ['From the Start', 'Laufey'],
            ['Praise The Lord', 'A$AP Rocky'],
            ['Pretty Girl', 'Clairo'],
        ] as $i => [$title, $artist]) {
            $playlist->songs()->create([
                'position' => $i, 'title' => $title, 'artist' => $artist,
                'album' => '', 'cover' => '', 'youtube_id' => 'video00000'.$i,
                'mp3_url' => '', 'spotify_id' => '',
            ]);
        }

        return $user;
    }

    public function test_requires_authentication(): void
    {
        // This app's auth middleware redirects guests to login (302)
        // rather than returning 401 for JSON requests.
        $this->postJson('/recommendations')->assertRedirect();
    }

    public function test_reports_disabled_without_api_key(): void
    {
        config(['services.gemini.key' => null]);

        $this->actingAs($this->userWithLibrary())
            ->postJson('/recommendations')
            ->assertOk()
            ->assertJson(['success' => true, 'enabled' => false, 'suggestions' => []]);
    }

    public function test_returns_parsed_suggestions_and_filters_owned_songs(): void
    {
        config(['services.gemini.key' => 'test-key']);

        $modelJson = json_encode([
            ['title' => 'After Hours', 'artist' => 'The Weeknd', 'reason' => 'Moody late-night R&B like your Toliver picks'],
            ['title' => 'No Pole', 'artist' => 'Don Toliver', 'reason' => 'Already owned — must be filtered'],
            ['title' => 'Valentine', 'artist' => 'Laufey', 'reason' => str_repeat('long reason ', 30)],
            ['title' => '', 'artist' => 'Nobody', 'reason' => 'missing title — must be dropped'],
        ]);

        Http::fake([
            'generativelanguage.googleapis.com/*' => Http::response([
                'candidates' => [[
                    'content' => ['parts' => [['text' => "```json\n{$modelJson}\n```"]]],
                ]],
            ]),
        ]);

        $res = $this->actingAs($this->userWithLibrary())
            ->postJson('/recommendations')
            ->assertOk()
            ->assertJson(['success' => true, 'enabled' => true]);

        $suggestions = $res->json('suggestions');
        $this->assertCount(2, $suggestions);
        $this->assertSame('After Hours', $suggestions[0]['title']);
        $this->assertSame('The Weeknd', $suggestions[0]['artist']);
        $this->assertSame('Valentine', $suggestions[1]['title']);
        $this->assertLessThanOrEqual(140, mb_strlen($suggestions[1]['reason']));
        // The owned song never comes back.
        $this->assertNotContains('No Pole', array_column($suggestions, 'title'));
    }

    public function test_enabled_but_empty_for_tiny_libraries(): void
    {
        config(['services.gemini.key' => 'test-key']);
        Http::fake();

        $this->actingAs($this->verifiedUser())
            ->postJson('/recommendations')
            ->assertOk()
            ->assertJson(['success' => true, 'enabled' => true, 'suggestions' => []]);

        Http::assertNothingSent();
    }

    public function test_model_garbage_is_not_echoed_back(): void
    {
        config(['services.gemini.key' => 'test-key']);

        Http::fake([
            'generativelanguage.googleapis.com/*' => Http::response([
                'candidates' => [[
                    'content' => ['parts' => [['text' => 'I cannot help with that request.']]],
                ]],
            ]),
        ]);

        $res = $this->actingAs($this->userWithLibrary())
            ->postJson('/recommendations')
            ->assertOk()
            ->assertJson(['success' => false, 'enabled' => true]);

        $this->assertStringNotContainsString('cannot help', json_encode($res->json()));
    }
}
