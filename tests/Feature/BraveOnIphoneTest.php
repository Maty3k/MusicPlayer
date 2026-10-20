<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

// Brave on iPhone: a WebKit browser like Safari that can't add apps to the
// Home Screen. The page says so where it matters (script.js shows those
// lines on an iPhone; html.m-brave comes from the head script).
class BraveOnIphoneTest extends TestCase
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

    // Dark Reader skips a page that carries this
    public function test_night_mode_leaves_the_page_alone(): void
    {
        $this->actingAs($this->member())->get('/')
            ->assertOk()
            ->assertSeeInOrder(['<head>', '<meta name="darkreader-lock">', '</head>'], false);
    }

    public function test_the_install_sheet_first_sends_brave_to_safari(): void
    {
        $response = $this->actingAs($this->member())->get('/');
        // The address the page was opened at, as the view reads it (in a
        // test it comes from APP_URL, which differs from machine to machine)
        $host = $response->baseRequest->getHttpHost();

        $this->assertNotSame('', $host);
        $response->assertOk()
            ->assertSee('<p class="m-sleep-status" id="mInstallBrave" hidden>Brave can\'t add apps to the Home Screen. Open <b>'.e($host).'</b> in Safari, then:</p>', false)
            ->assertSeeInOrder(['id="mInstallSheet"', 'id="mInstallBrave"', 'id="mInstallStepsIos"', 'In <b>Safari</b>, tap'], false);
    }

    public function test_the_downloads_note_covers_any_iphone_browser(): void
    {
        config(['services.cloud_music.url' => 'https://music.example.workers.dev', 'services.cloud_music.token' => 's3cret-token']);

        $this->actingAs($this->member())->get('/')
            ->assertOk()
            ->assertSee('<p class="settings-hint" id="cloudIosNote" hidden>On iPhone, the browser removes downloads from sites you don\'t open for a week. The app on your Home Screen keeps them (add it in Safari: Share → Add to Home Screen).</p>', false)
            ->assertDontSee('Safari removes downloads', false);
    }
}
