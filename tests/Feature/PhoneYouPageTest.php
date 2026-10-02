<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

// The phone Home avatar, the You page it opens, and the Settings it leads to
class PhoneYouPageTest extends TestCase
{
    use RefreshDatabase;

    private function member(array $attrs = []): User
    {
        return User::forceCreate(array_merge([
            'name' => 'Pat',
            'password' => bcrypt('1234'),
            'member_number' => 42,
        ], $attrs));
    }

    public function test_avatar_uses_the_first_letter_even_when_it_is_zero(): void
    {
        $user = User::forceCreate([
            'name' => '007',
            'email' => 'bond@example.com',
            'password' => bcrypt('a-long-password'),
            'email_verified_at' => now(),
        ]);

        $this->actingAs($user)->get('/')
            ->assertOk()
            ->assertSee('<span class="m-avatar" id="mAvatar">0</span>', false)
            ->assertSee('<b id="mAccountName">007</b>', false)
            ->assertSee('<p class="m-you-sub" id="mYouSub">bond@example.com</p>', false);
    }

    public function test_placeholder_name_falls_back_to_the_email_initial(): void
    {
        $user = User::forceCreate([
            'name' => 'New member',
            'email' => 'olive@example.com',
            'password' => bcrypt('a-long-password'),
            'email_verified_at' => now(),
        ]);

        $this->actingAs($user)->get('/')
            ->assertOk()
            ->assertSee('<span class="m-avatar" id="mAvatar">O</span>', false)
            ->assertSee('<b id="mAccountName">Your account</b>', false);
    }

    public function test_spotify_only_account_says_how_it_signs_in_and_gets_no_password_forms(): void
    {
        $user = User::forceCreate([
            'name' => 'Spotify listener',
            'password' => bcrypt('a-long-password'),
            'spotify_user_id' => 'sp-123',
        ]);

        // Its password is random: there's nothing to type into "Current password".
        $this->actingAs($user)->get('/')
            ->assertOk()
            ->assertSee('<span class="m-avatar" id="mAvatar">♪</span>', false)
            ->assertSee('<p class="m-you-sub" id="mYouSub">Signed in with Spotify</p>', false)
            ->assertSee('<div class="settings-hint" id="settingsAccountEmail">Signed in with Spotify</div>', false)
            ->assertDontSee('id="settingsPasswordDetails"', false)
            ->assertDontSee('id="settingsAttachEmailDetails"', false)
            ->assertSee('<small>Your name</small>', false);
    }

    public function test_member_without_email_can_attach_one_with_a_pin_or_a_password(): void
    {
        $this->actingAs($this->member())->get('/')
            ->assertOk()
            ->assertSee('<p class="m-you-sub" id="mYouSub">Member #0042</p>', false)
            ->assertSee('id="settingsAttachEmailDetails"', false)
            ->assertSee('id="settingsPasswordDetails"', false)
            // a member who changed the PIN to a password must be able to type it
            ->assertDontSee('maxlength="4"', false)
            ->assertSee('<small>Name and password</small>', false);
    }

    public function test_without_spotify_set_up_settings_show_no_spotify_or_developer_text(): void
    {
        config(['services.spotify.client_id' => null]);

        $this->actingAs($this->member())->get('/')
            ->assertOk()
            ->assertDontSee('services.spotify')
            ->assertDontSee('id="spotifyNotConnected"', false)
            ->assertSee('<small>Name and password</small>', false);
    }

    public function test_with_spotify_set_up_settings_offer_it(): void
    {
        config(['services.spotify.client_id' => 'client-id']);

        $this->actingAs($this->member())->get('/')
            ->assertOk()
            ->assertSee('id="spotifyNotConnected"', false)
            ->assertSee('<small>Name and password, Spotify</small>', false)
            ->assertDontSee('services.spotify');
    }

    public function test_full_screen_and_install_rows_start_hidden_for_the_script_to_offer(): void
    {
        // Shown only in a browser tab (script.js), never in the installed app.
        $this->actingAs($this->member())->get('/')
            ->assertOk()
            ->assertSee('<div class="m-you-device" id="mYouDevice" hidden>', false)
            ->assertSee('id="mYouFullscreen" data-keeps-gesture hidden', false)
            ->assertSee('id="mYouInstall" hidden', false)
            ->assertSee('id="mInstallSheet"', false);
    }

    public function test_full_screen_switches_and_the_home_button_start_hidden_and_off(): void
    {
        // Per-device choices (localStorage); script.js shows and sets them.
        $this->actingAs($this->member())->get('/')
            ->assertOk()
            ->assertSee('id="mYouFsAuto" role="switch" aria-checked="false" data-keeps-gesture hidden', false)
            ->assertSee('id="mYouFsButton" role="switch" aria-checked="false" data-keeps-gesture hidden', false)
            ->assertSee('id="mFsBtn" aria-label="Full screen" data-keeps-gesture hidden', false)
            ->assertSee('data-m-pl="share" data-keeps-gesture', false)
            ->assertSeeInOrder(['id="mHomeHead"', 'id="mFsBtn"', 'id="mAvatarBtn"'], false)
            ->assertSeeInOrder(['id="mYouFullscreen"', 'id="mYouFsAuto"', 'id="mYouFsButton"', 'id="mYouInstall"'], false);
    }

    public function test_add_song_source_sits_under_advanced(): void
    {
        $this->actingAs($this->member())->get('/')
            ->assertOk()
            ->assertSeeInOrder(['id="sleepOptions"', 'id="settingsAdvancedDetails"', '<summary>Advanced</summary>', 'id="settingsSourceOptions"'], false);
    }
}
