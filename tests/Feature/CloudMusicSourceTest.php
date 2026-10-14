<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

// Settings → Source: your playlists or the Cloudflare Worker's files. The page
// learns only whether the source is set up, never the Worker's address or token.
class CloudMusicSourceTest extends TestCase
{
    use RefreshDatabase;

    private const DISABLED_CLOUD_BUTTON = '/data-song-source="cloud"[^>]*\sdisabled[\s>]/';

    private function member(): User
    {
        return User::forceCreate([
            'name' => 'Pat',
            'password' => bcrypt('1234'),
            'member_number' => 42,
        ]);
    }

    public function test_without_a_worker_the_option_shows_but_cannot_be_picked(): void
    {
        config(['services.cloud_music.url' => '', 'services.cloud_music.token' => '']);

        $response = $this->actingAs($this->member())->get('/');

        $response->assertOk()
            ->assertSee('data-m-you="source"', false)
            ->assertSee('data-dv-acct="source"', false)
            ->assertSee('data-panel="source"', false)
            ->assertSee('const CLOUD_MUSIC = false;', false)
            ->assertSee("Cloudflare isn't set up on this server yet", false)
            ->assertDontSee('id="cloudUploadInput"', false);
        $this->assertMatchesRegularExpression(self::DISABLED_CLOUD_BUTTON, $response->getContent());
    }

    public function test_a_worker_address_without_its_token_is_not_set_up_either(): void
    {
        config(['services.cloud_music.url' => 'https://music.example.workers.dev', 'services.cloud_music.token' => '']);

        $response = $this->actingAs($this->member())->get('/');

        $response->assertOk()
            ->assertSee('const CLOUD_MUSIC = false;', false)
            ->assertDontSee('music.example.workers.dev', false);
        $this->assertMatchesRegularExpression(self::DISABLED_CLOUD_BUTTON, $response->getContent());
    }

    public function test_with_a_worker_the_page_learns_only_that_it_is_set_up(): void
    {
        config(['services.cloud_music.url' => 'https://music.example.workers.dev', 'services.cloud_music.token' => 's3cret-token']);

        $response = $this->actingAs($this->member())->get('/');

        $response->assertOk()
            ->assertSee('const CLOUD_MUSIC = true;', false)
            ->assertDontSee('s3cret-token', false)
            ->assertDontSee('music.example.workers.dev', false)
            ->assertSee('id="cloudUploadInput"', false)
            ->assertSee('js/cloud-music.js', false)
            ->assertSeeInOrder(['data-tab="appearance"', 'data-tab="source"', 'data-tab="account"'], false);
        $this->assertDoesNotMatchRegularExpression(self::DISABLED_CLOUD_BUTTON, $response->getContent());
    }
}
