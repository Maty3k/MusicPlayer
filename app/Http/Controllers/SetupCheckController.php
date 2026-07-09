<?php

namespace App\Http\Controllers;

use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * First-boot self-diagnosis page (GET /setup-check).
 *
 * Publicly reachable on purpose: it exists precisely for the case where
 * registration/login are broken, so it can't sit behind auth. It reveals only
 * booleans and driver names — never secrets, hosts, or credentials.
 */
class SetupCheckController extends Controller
{
    public function __invoke(): Response
    {
        $checks = [];

        // 1) App key
        $checks[] = [
            'label' => 'Application key (APP_KEY)',
            'ok' => (bool) config('app.key'),
            'fix' => 'Laravel Cloud manages this automatically. Locally: php artisan key:generate.',
        ];

        // 2) Database connection
        $dbOk = false;
        $dbDetail = '';
        try {
            DB::connection()->getPdo();
            $dbOk = true;
            $dbDetail = 'connected ('.DB::connection()->getDriverName().')';
        } catch (\Throwable $e) {
            $dbDetail = 'cannot connect';
        }
        $checks[] = [
            'label' => 'Database connection — '.$dbDetail,
            'ok' => $dbOk,
            'fix' => 'In Laravel Cloud: open your environment, create/attach a database (Postgres), then redeploy. The connection settings are injected automatically.',
        ];

        // 3) Migrations
        $tablesOk = false;
        if ($dbOk) {
            try {
                $tablesOk = Schema::hasTable('users') && Schema::hasTable('playlists') && Schema::hasTable('songs');
            } catch (\Throwable $e) {
                $tablesOk = false;
            }
        }
        $checks[] = [
            'label' => 'Database tables (migrations have run)',
            'ok' => $tablesOk,
            'fix' => 'In Laravel Cloud: Environment settings → Deploy commands → add "php artisan migrate --force", then redeploy.',
        ];

        // 4) Session driver sanity (database sessions need the table)
        $sessionDriver = (string) config('session.driver');
        $sessionOk = $sessionDriver !== 'database' || ($dbOk && Schema::hasTable('sessions'));
        $checks[] = [
            'label' => "Sessions (driver: {$sessionDriver})",
            'ok' => $sessionOk,
            'fix' => 'Database sessions need the sessions table — run migrations (see above).',
        ];

        // 5) Mail transport
        $mailer = (string) config('mail.default');
        $resendKeySet = (bool) config('services.resend.key');
        $mailOk = $mailer !== 'resend' || $resendKeySet;
        $checks[] = [
            'label' => "Mail (mailer: {$mailer}".($mailer === 'resend' ? ', API key '.($resendKeySet ? 'set' : 'MISSING') : '').')',
            'ok' => $mailOk,
            'fix' => 'Set RESEND_API_KEY in the environment variables. Note: until you verify a domain at resend.com/domains, Resend only delivers to your own account email, from onboarding@resend.dev.',
        ];

        $allOk = collect($checks)->every(fn ($c) => $c['ok']);

        $rows = '';
        foreach ($checks as $c) {
            $mark = $c['ok']
                ? '<span class="ok">&#10004;</span>'
                : '<span class="bad">&#10008;</span>';
            $fix = $c['ok'] ? '' : '<div class="fix">'.e($c['fix']).'</div>';
            $rows .= '<div class="row">'.$mark.'<div><div class="lbl">'.e($c['label']).'</div>'.$fix.'</div></div>';
        }

        $headline = $allOk
            ? '<p class="all-ok">Everything looks good — <a href="/register">create your account</a>.</p>'
            : '<p class="not-ok">Fix the items marked &#10008; below, then redeploy and refresh this page.</p>';

        $html = <<<HTML
<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Music Player — setup check</title>
<style>
body{background:#1a1510;color:#f2e8d8;font-family:system-ui,sans-serif;display:flex;justify-content:center;padding:48px 16px}
.card{max-width:640px;width:100%;background:linear-gradient(180deg,#2c251d,#1e1a14);border:1px solid rgba(212,165,116,.25);border-radius:16px;padding:32px}
h1{font-size:1.2rem;color:#d4a574;margin:0 0 4px} .sub{color:rgba(242,232,216,.55);font-size:.85rem;margin:0 0 20px}
.row{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid rgba(212,165,116,.1);align-items:flex-start}
.ok{color:#5cba5c}.bad{color:#e85d75}.lbl{font-size:.9rem}
.fix{font-size:.78rem;color:rgba(242,232,216,.6);margin-top:4px;line-height:1.5}
.all-ok{color:#8fd08f}.not-ok{color:#e88d9d}a{color:#d4a574}
</style></head><body><div class="card">
<h1>&#9834; Music Player — setup check</h1>
<p class="sub">Safe to share: this page shows only pass/fail states, never secrets.</p>
{$headline}
{$rows}
</div></body></html>
HTML;

        return response($html);
    }
}
