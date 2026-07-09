<?php
// Shared JSON store helpers for data/*.json.
//
// The save-*.php endpoints do read-modify-write: load the whole file, mutate
// it in memory, write it back. To make that safe against concurrent requests
// (lost updates) the read AND the write must happen under one lock. Call
// nt_lock_json($path) where you currently read the file — it takes an
// exclusive cross-process lock (on a "<path>.lock" sidecar) and returns the
// current contents. The lock is held for the rest of the request and released
// automatically when the script ends, so the subsequent nt_save_json($path)
// completes the read-modify-write cycle atomically with no interleaving.
//
// Every writer of a given file must read it via nt_lock_json() for the lock to
// be effective (e.g. music.json is mutated by save-music.php AND spotify.php —
// all of them lock the same sidecar).

// Acquire the per-file write lock (once per request) and return the decoded
// contents, or $default if the file is missing / unreadable / not an array.
function nt_lock_json(string $path, $default = []) {
    static $locks = [];
    if (!isset($locks[$path])) {
        $fh = @fopen($path . '.lock', 'c');
        if ($fh !== false && @flock($fh, LOCK_EX)) {
            // Keep the handle (and thus the lock) alive for the whole request;
            // PHP releases it on shutdown, ending the critical section.
            $locks[$path] = $fh;
        } else {
            // Lock acquisition failed (unwritable data dir, fd limit, transient
            // FS error). The caller's read-modify-write will then run WITHOUT a
            // lock, so make that observable rather than silently risking a lost
            // update. (Previously a failed flock was ignored and treated as held.)
            if ($fh !== false) @fclose($fh);
            error_log('nt_lock_json: could not acquire lock for ' . $path . ' — write will be unsynchronized');
        }
    }
    if (!file_exists($path)) return $default;
    $raw = @file_get_contents($path);
    if ($raw === false) return $default;
    $data = json_decode($raw, true);
    return is_array($data) ? $data : $default;
}

// Atomic JSON writer. Writes to a per-process temp file and atomically
// rename()s it over the target, so a failed or partial encode can never
// truncate the live file. Pair with nt_lock_json() to also prevent lost
// updates across the read-modify-write cycle.
//
// Returns true on success, false if encoding or the write/rename failed
// (callers should surface an error rather than assume the write landed).
function nt_save_json(string $path, $data, int $flags = JSON_PRETTY_PRINT): bool {
    try {
        $json = json_encode($data, $flags | JSON_THROW_ON_ERROR);
    } catch (\JsonException $e) {
        error_log('nt_save_json: encode failed for ' . $path . ': ' . $e->getMessage());
        return false;
    }
    return nt_save_raw($path, $json);
}

// Atomic raw-string writer (temp file + rename). Use for already-serialized
// content such as cached upstream API responses, where nt_save_json would
// double-encode the string.
function nt_save_raw(string $path, string $contents): bool {
    $tmp = $path . '.tmp.' . getmypid();
    if (@file_put_contents($tmp, $contents, LOCK_EX) === false) {
        return false;
    }
    if (!@rename($tmp, $path)) {
        @unlink($tmp);
        return false;
    }
    return true;
}
