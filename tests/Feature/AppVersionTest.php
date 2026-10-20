<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\AppBuild;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

// The build a page belongs to and the one the server runs (script.js,
// "New versions"), and the version line people read out
class AppVersionTest extends TestCase
{
    use RefreshDatabase;

    private function listener(): User
    {
        return User::forceCreate([
            'name' => 'Pat',
            'email' => 'pat@example.com',
            'password' => bcrypt('a-long-password'),
            'email_verified_at' => now(),
        ]);
    }

    public function test_version_names_the_build_and_is_never_kept(): void
    {
        DB::enableQueryLog();

        // Signed out, like a page whose session ended: the answer, not the login page
        $response = $this->get('/version')
            ->assertOk()
            ->assertExactJson(['build' => AppBuild::id(), 'label' => AppBuild::label()]);

        $this->assertStringContainsString('no-store', (string) $response->headers->get('Cache-Control'));
        // No session: no cookie and no database, however often pages ask
        $this->assertFalse($response->headers->has('Set-Cookie'));
        $this->assertSame([], DB::getQueryLog());
    }

    public function test_the_page_carries_its_build_and_shows_it(): void
    {
        $this->actingAs($this->listener())->get('/')
            ->assertOk()
            ->assertSee('<meta name="app-build" content="'.AppBuild::id().'">', false)
            ->assertSee('<p class="m-you-version" id="mYouVersion">Version '.AppBuild::label().'</p>', false)
            ->assertSee('<p class="settings-hint" id="settingsVersion">Version '.AppBuild::label().'</p>', false)
            ->assertSeeInOrder(['class="m-you-logout"', 'id="mYouVersion"'], false)
            ->assertSeeInOrder(['class="settings-logout-form"', 'id="settingsVersion"'], false);
    }

    // script.js shows it when a newer build can't load by itself (music on, a sheet open…)
    public function test_the_new_version_offer_starts_hidden_for_the_script_to_show(): void
    {
        $this->actingAs($this->listener())->get('/')
            ->assertOk()
            ->assertSee('<div class="app-flash app-flash-offer" id="appUpdateOffer" role="status" hidden>', false)
            ->assertSee('<span>A new version of the app is ready.</span>', false)
            ->assertSee('<button type="button" class="app-flash-btn" id="appUpdateNow">Refresh</button>', false)
            ->assertSee('<button type="button" class="app-flash-btn app-flash-btn-quiet" id="appUpdateLater">Later</button>', false)
            // Outside the page's #music-section, whose stacking would cap it
            // under the desktop side panel
            ->assertSeeInOrder(['<body>', 'id="appUpdateOffer"', '<main id="music-section">'], false);
    }

    public function test_the_label_is_the_build_as_a_utc_date(): void
    {
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/', AppBuild::label());
        $this->assertSame(gmdate('Y-m-d H:i', AppBuild::id()).' UTC', AppBuild::label());
    }

    // Every file the page loads with ?v= counts, so a deploy changing any of them is noticed
    public function test_every_versioned_file_counts_toward_the_build(): void
    {
        config(['services.cloud_music.url' => 'https://worker.example', 'services.cloud_music.token' => 'test-token']);
        $html = $this->actingAs($this->listener())->get('/')->assertOk()->getContent();

        preg_match_all('#/((?:css|js|vendor)/[^"?]+)\?v=\d+#', $html, $found);
        $this->assertEqualsCanonicalizing(AppBuild::ASSETS, array_values(array_unique($found[1])));
    }

    public function test_a_newer_file_makes_a_newer_build(): void
    {
        $file = public_path('js/script.js');
        $was = filemtime($file);
        $later = AppBuild::id() + 60;
        try {
            touch($file, $later);
            clearstatcache();
            $this->assertSame($later, AppBuild::id());
        } finally {
            touch($file, $was);
            clearstatcache();
        }
    }
}
