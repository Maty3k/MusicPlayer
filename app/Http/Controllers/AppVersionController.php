<?php

namespace App\Http\Controllers;

use App\Support\AppBuild;
use Illuminate\Http\JsonResponse;

/**
 * GET /version: the build this server runs (App\Support\AppBuild), asked by
 * an open player page to notice a deploy. Public like /up: it names a
 * deploy time and nothing else, and a page whose session ended must get
 * this, not the login page. Outside the web group (routes/web.php), so no
 * session, cookie or database however often pages ask. Never stored: a
 * kept answer would hide the very deploy it announces.
 */
class AppVersionController extends Controller
{
    public function __invoke(): JsonResponse
    {
        return response()
            ->json(['build' => AppBuild::id(), 'label' => AppBuild::label()])
            ->header('Cache-Control', 'no-store');
    }
}
