<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class AccountSettingsTest extends TestCase
{
    use RefreshDatabase;

    private function verifiedUser(): User
    {
        return User::forceCreate([
            'name' => 'Curator',
            'email' => 'curator@example.com',
            'password' => bcrypt('old-password'),
            'email_verified_at' => now(),
        ]);
    }

    public function test_name_can_be_updated(): void
    {
        $user = $this->verifiedUser();

        $this->actingAs($user)->postJson('/settings/name', ['name' => 'New Name'])
            ->assertOk()->assertJson(['success' => true, 'name' => 'New Name']);

        $this->assertSame('New Name', $user->fresh()->name);
    }

    public function test_empty_name_is_rejected(): void
    {
        $user = $this->verifiedUser();

        $this->actingAs($user)->postJson('/settings/name', ['name' => ''])
            ->assertStatus(422);

        $this->assertSame('Curator', $user->fresh()->name);
    }

    public function test_password_can_be_changed_with_current_password(): void
    {
        $user = $this->verifiedUser();

        $this->actingAs($user)->postJson('/settings/password', [
            'current_password' => 'old-password',
            'password' => 'brand-new-password',
            'password_confirmation' => 'brand-new-password',
        ])->assertOk()->assertJson(['success' => true]);

        $this->assertTrue(Hash::check('brand-new-password', $user->fresh()->password));
    }

    public function test_wrong_current_password_is_rejected(): void
    {
        $user = $this->verifiedUser();

        $this->actingAs($user)->postJson('/settings/password', [
            'current_password' => 'not-my-password',
            'password' => 'brand-new-password',
            'password_confirmation' => 'brand-new-password',
        ])->assertStatus(422)->assertJsonValidationErrors('current_password');

        $this->assertTrue(Hash::check('old-password', $user->fresh()->password));
    }

    public function test_guests_cannot_touch_account_settings(): void
    {
        $this->postJson('/settings/name', ['name' => 'Nope'])->assertStatus(401);
        $this->postJson('/settings/password', [
            'current_password' => 'x',
            'password' => 'whatever-pass',
            'password_confirmation' => 'whatever-pass',
        ])->assertStatus(401);
    }
}
