<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

// The phone Home avatar and its account sheet (initial + the line under the name)
class PhoneAccountSheetTest extends TestCase
{
    use RefreshDatabase;

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
            ->assertSee('bond@example.com');
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

    public function test_spotify_only_account_says_how_it_signs_in(): void
    {
        $user = User::forceCreate([
            'name' => 'Spotify listener',
            'password' => bcrypt('a-long-password'),
            'spotify_user_id' => 'sp-123',
        ]);

        $this->actingAs($user)->get('/')
            ->assertOk()
            ->assertSee('<span class="m-avatar" id="mAvatar">♪</span>', false)
            ->assertSee('Signed in with Spotify')
            ->assertDontSee('<small>Member </small>', false);
    }
}
