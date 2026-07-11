<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
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

    public function updatePassword(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'current_password' => ['required', 'current_password'],
            'password' => ['required', 'confirmed', Password::min(8)],
        ]);

        // The 'hashed' cast on the model hashes this on assignment.
        $request->user()->update(['password' => $validated['password']]);

        return response()->json(['success' => true]);
    }
}
