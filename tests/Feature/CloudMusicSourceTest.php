<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

// Settings → Source: your playlists or the Cloudflare Worker's files. It shows
// only where the source is set up, and the page learns only that it is, never
// the Worker's address or token.
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

    public function test_without_a_worker_there_is_no_cloudflare_choice_anywhere(): void
    {
        config(['services.cloud_music.url' => '', 'services.cloud_music.token' => '']);

        $this->actingAs($this->member())->get('/')
            ->assertOk()
            ->assertSee('const CLOUD_MUSIC = false;', false)
            ->assertDontSee('data-m-you="source"', false)
            ->assertDontSee('data-dv-acct="source"', false)
            ->assertDontSee('data-tab="source"', false)
            ->assertDontSee('data-panel="source"', false)
            ->assertDontSee('with-source', false)
            ->assertDontSee('id="cloudDownloadAllBtn"', false)
            ->assertDontSee('js/cloud-music.js', false);
    }

    public function test_a_worker_address_without_its_token_is_not_set_up_either(): void
    {
        config(['services.cloud_music.url' => 'https://music.example.workers.dev', 'services.cloud_music.token' => '']);

        $this->actingAs($this->member())->get('/')
            ->assertOk()
            ->assertSee('const CLOUD_MUSIC = false;', false)
            ->assertDontSee('data-panel="source"', false)
            ->assertDontSee('music.example.workers.dev', false);
    }

    public function test_with_a_worker_the_page_learns_only_that_it_is_set_up(): void
    {
        config(['services.cloud_music.url' => 'https://music.example.workers.dev', 'services.cloud_music.token' => 's3cret-token']);

        $this->actingAs($this->member())->get('/')
            ->assertOk()
            ->assertSee('const CLOUD_MUSIC = true;', false)
            ->assertDontSee('s3cret-token', false)
            ->assertDontSee('music.example.workers.dev', false)
            ->assertSee('data-m-you="source"', false)
            ->assertSee('data-dv-acct="source"', false)
            ->assertSee('class="settings-tabs with-source"', false)
            ->assertSeeInOrder(['data-tab="appearance"', 'data-tab="source"', 'data-tab="account"'], false)
            ->assertSee('id="cloudUploadInput"', false)
            ->assertSee('js/cloud-music.js', false);
    }

    public function test_with_a_worker_the_source_tab_offers_keeping_songs_on_the_device(): void
    {
        config(['services.cloud_music.url' => 'https://music.example.workers.dev', 'services.cloud_music.token' => 's3cret-token']);

        $this->actingAs($this->member())->get('/')
            ->assertOk()
            ->assertSeeInOrder(['data-panel="source"', 'On this device', 'id="cloudOfflineStatus"', 'id="cloudDownloadAllBtn"', 'id="cloudRemoveDownloadsBtn"'], false)
            ->assertSee('onclick="cloudMusic.downloadAll()"', false)
            ->assertSee('onclick="cloudMusic.removeDownloads()"', false);
    }
}
