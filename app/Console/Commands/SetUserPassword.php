<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rules\Password;

/**
 * Sets a user's password from the CLI. Escape hatch for while the Resend
 * domain is unverified — the emailed reset-link flow can't deliver to
 * addresses other than the account owner's.
 */
class SetUserPassword extends Command
{
    protected $signature = 'user:password
        {email : Email of the user}
        {password : New password (at least 8 characters)}';

    protected $description = "Set a user's password";

    public function handle(): int
    {
        $email = strtolower(trim((string) $this->argument('email')));
        $password = (string) $this->argument('password');

        $user = User::where('email', $email)->first();
        if ($user === null) {
            $this->error("No user found with email {$email}.");

            return self::FAILURE;
        }

        $validator = Validator::make(['password' => $password], [
            'password' => ['required', Password::min(8)],
        ]);
        if ($validator->fails()) {
            foreach ($validator->errors()->all() as $error) {
                $this->error($error);
            }

            return self::FAILURE;
        }

        // The 'hashed' cast hashes on assignment; also rotate the remember
        // token so any stale "remember me" sessions stop working.
        $user->forceFill([
            'password' => $password,
            'remember_token' => null,
        ])->save();

        $this->info("Password updated for {$email}.");

        return self::SUCCESS;
    }
}
