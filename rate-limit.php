<?php
// Tiny per-IP, per-bucket rate limiter backed by a JSON file under data/.
// Each call records a request and enforces a sliding-window cap.
// On limit hit, sets HTTP 429 and exits with a JSON error.
//
// The read-check-write sequence is performed under an exclusive flock() so
// concurrent requests can't both read a count below the cap and both proceed
// (TOCTOU bypass). The limiter fails open if the lock/file can't be acquired —
// it is best-effort abuse protection, not an auth control.
function nt_rate_limit($bucket, $maxPerMin = 30, $maxPerDay = 500) {
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    $key = preg_replace('/[^a-zA-Z0-9_.-]/', '_', $bucket . '_' . $ip);
    $path = __DIR__ . '/data/.ratelimit-' . $key . '.json';
    $now = time();

    $fh = @fopen($path, 'c+');
    if ($fh === false) return;
    if (!flock($fh, LOCK_EX)) { fclose($fh); return; }

    $raw = stream_get_contents($fh);
    $entries = $raw ? (json_decode($raw, true) ?: []) : [];
    // Drop entries older than 24h
    $entries = array_values(array_filter($entries, function ($t) use ($now) {
        return is_int($t) && ($now - $t) < 86400;
    }));

    $perMin = 0;
    foreach ($entries as $t) { if (($now - $t) < 60) $perMin++; }
    if ($perMin >= $maxPerMin || count($entries) >= $maxPerDay) {
        flock($fh, LOCK_UN);
        fclose($fh);
        http_response_code(429);
        echo json_encode(['success' => false, 'error' => 'Rate limit exceeded. Try again later.']);
        exit;
    }

    $entries[] = $now;
    rewind($fh);
    ftruncate($fh, 0);
    fwrite($fh, json_encode($entries));
    fflush($fh);
    flock($fh, LOCK_UN);
    fclose($fh);

    // Opportunistically (~1% of calls) sweep per-IP state files that haven't
    // been written in over 24h, so the number of .ratelimit-* files can't grow
    // without bound as distinct client IPs / buckets accumulate.
    if (mt_rand(1, 100) === 1) {
        foreach (glob(__DIR__ . '/data/.ratelimit-*.json') ?: [] as $f) {
            if (@filemtime($f) < $now - 86400) @unlink($f);
        }
    }
}
