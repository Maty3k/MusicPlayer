<?php
// Access guard for the write / secret endpoints of the standalone Music Player.
//
// This app has no user accounts; it is designed for a single owner. But unlike
// the parent "notes" app (which is strictly loopback-only), the Music Player
// also serves a companion React Native shell that talks to it over the LAN, so
// a pure 127.0.0.1 allowlist would lock the phone out. Instead:
//
//   * requests from the loopback interface are always trusted (the desktop
//     browser on the same machine), and
//   * requests from anywhere else must present the shared secret from
//     config.php ('api_token') as a Bearer / X-Api-Token header.
//
// If no api_token is configured, the guard falls back to loopback-only — so a
// fresh checkout is secure by default and never hands out LAN access until the
// owner deliberately sets a token and ships it to their phone.

function mp_config(): array {
    static $cfg = null;
    if ($cfg === null) {
        $f = __DIR__ . '/config.php';
        $cfg = file_exists($f) ? (require $f) : [];
        if (!is_array($cfg)) $cfg = [];
    }
    return $cfg;
}

function mp_is_loopback(): bool {
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    return in_array($ip, ['127.0.0.1', '::1', '::ffff:127.0.0.1'], true);
}

// Pull the presented secret from either an Authorization: Bearer header or an
// X-Api-Token header (the WebView shell uses the latter via a fetch shim).
function mp_presented_token(): string {
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if ($auth === '' && function_exists('getallheaders')) {
        foreach (getallheaders() as $k => $v) {
            if (strcasecmp($k, 'Authorization') === 0) { $auth = $v; break; }
        }
    }
    if (stripos($auth, 'Bearer ') === 0) {
        return trim(substr($auth, 7));
    }
    return trim($_SERVER['HTTP_X_API_TOKEN'] ?? '');
}

// Gate a mutating / secret-bearing endpoint. Call at the very top, before any
// input parsing. Emits 403 JSON and exits for unauthorized callers.
function mp_require_auth(): void {
    if (mp_is_loopback()) return;

    $token = (string)(mp_config()['api_token'] ?? '');
    if ($token !== '') {
        $presented = mp_presented_token();
        if ($presented !== '' && hash_equals($token, $presented)) return;
    }

    http_response_code(403);
    header('Content-Type: application/json');
    echo json_encode(['success' => false, 'error' => 'forbidden']);
    exit;
}
