<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;

/**
 * Marks a user's email as verified from the CLI. Escape hatch for while the
 * Resend domain is unverified (test mode only delivers to the account owner,
 * so other addresses can never receive their verification link).
 */
class VerifyUserEmail extends Command
{
    protected $signature = 'user:verify {email : Email of the user to mark as verified}';

    protected $description = "Mark a user's email address as verified";

    public function handle(): int
    {
        $email = (string) $this->argument('email');
        $user = User::where('email', $email)->first();
        if ($user === null) {
            $this->error("No user found with email {$email}.");

            return self::FAILURE;
        }

        if ($user->hasVerifiedEmail()) {
            $this->info("{$email} is already verified.");

            return self::SUCCESS;
        }

        $user->markEmailAsVerified();
        $this->info("Marked {$email} as verified.");

        return self::SUCCESS;
    }
}
