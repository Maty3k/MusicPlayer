<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\Rules\Password;

/**
 * In-app account settings (fetch/JSON, consumed by the Settings modal).
 * Changing the password here needs the current password — unlike the emailed
 * reset flow, so it works even while the mail transport is unverified.
 */
class AccountController extends Controller
{
    public function updateName(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:100'],
        ]);

        $request->user()->update(['name' => $validated['name']]);

        return response()->json(['success' => true, 'name' => $validated['name']]);
    }

    /**
     * Member-number accounts start with no email; attaching one upgrades the
     * account (login by email, password reset) without touching the member
     * number, which keeps working. Requires the current PIN/password so a
     * borrowed open session can't be claimed by someone else's email.
     */
    public function attachEmail(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'email' => ['required', 'string', 'lowercase', 'email', 'max:255', 'unique:users,email'],
            'current_password' => ['required', 'current_password'],
        ]);

        $request->user()->update(['email' => $validated['email']]);

        return response()->json(['success' => true, 'email' => $validated['email']]);
    }

    public function updatePassword(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'current_password' => ['required', 'current_password'],
            'password' => ['required', 'confirmed', Password::min(8)],
        ]);

        // The 'hashed' cast on the model hashes this on assignment.
        $request->user()->update(['password' => $validated['password']]);

        // Every other device is signed out by the new hash (see
        // EndSessionsOnPasswordChange); this refreshes the "stay signed in"
        // cookie so the device that made the change keeps it.
        Auth::logoutOtherDevices($validated['password']);

        return response()->json(['success' => true]);
    }
}
