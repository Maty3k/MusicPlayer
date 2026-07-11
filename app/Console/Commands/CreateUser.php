<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rules\Password;

/**
 * Creates a ready-to-use account from the CLI, mirroring what registration
 * does (bootstrap Favorites playlist, active slug). Verified by default —
 * the same Resend test-mode escape hatch as user:verify.
 */
class CreateUser extends Command
{
    protected $signature = 'user:create
        {email : Email address for the new account}
        {name : Display name}
        {password : Initial password (at least 8 characters)}
        {--unverified : Leave the email unverified so the user must confirm it}';

    protected $description = 'Create a user account with the bootstrap Favorites playlist';

    public function handle(): int
    {
        $data = [
            'email' => strtolower(trim((string) $this->argument('email'))),
            'name' => trim((string) $this->argument('name')),
            'password' => (string) $this->argument('password'),
        ];

        $validator = Validator::make($data, [
            'name' => ['required', 'string', 'max:100'],
            'email' => ['required', 'string', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', Password::min(8)],
        ]);
        if ($validator->fails()) {
            foreach ($validator->errors()->all() as $error) {
                $this->error($error);
            }

            return self::FAILURE;
        }

        if (! $this->option('unverified')) {
            $data['email_verified_at'] = now();
        }

        $user = User::forceCreate($data);

        // Same bootstrap the registration flow performs.
        $user->playlists()->create([
            'slug' => 'favorites',
            'name' => 'Favorites',
            'position' => 0,
        ]);
        $user->update(['active_playlist_slug' => 'favorites', 'recently_played' => ['favorites']]);

        $this->info("Created {$data['email']}".($this->option('unverified') ? ' (unverified)' : ' (verified)').'.');

        return self::SUCCESS;
    }
}
