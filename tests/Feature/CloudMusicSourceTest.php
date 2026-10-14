<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

// Settings → Source: your playlists or the Cloudflare Worker's files
class CloudMusicSourceTest extends TestCase
{
    use RefreshDatabase;

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

        $this->actingAs($this->member())->get('/')
            ->assertOk()
            ->assertSee('data-m-you="source"', false)
            ->assertSee('data-dv-acct="source"', false)
            ->assertSee('data-panel="source"', false)
            ->assertSee('const CLOUD_MUSIC = null;', false)
            ->assertSee('onclick="cloudMusic.setSource(\'cloud\')" disabled', false)
            ->assertDontSee('id="cloudUploadInput"', false);
    }

    public function test_with_a_worker_the_page_gets_its_url_and_token(): void
    {
        config(['services.cloud_music.url' => 'https://music.example.workers.dev', 'services.cloud_music.token' => 's3cret']);

        $this->actingAs($this->member())->get('/')
            ->assertOk()
            ->assertSee('const CLOUD_MUSIC = {"url":"https:\/\/music.example.workers.dev","token":"s3cret"};', false)
            ->assertSee('id="cloudUploadInput"', false)
            ->assertSee('js/cloud-music.js', false)
            ->assertSeeInOrder(['data-tab="appearance"', 'data-tab="source"', 'data-tab="account"'], false);
    }
}
