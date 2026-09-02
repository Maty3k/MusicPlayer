<?php

namespace App\Support;

use RuntimeException;

/**
 * Spotify answered 429. Carries the Retry-After it asked for so the caller can
 * back off (or tell the browser to) instead of treating the page as missing.
 */
class SpotifyRateLimited extends RuntimeException
{
    public function __construct(public readonly int $retryAfter)
    {
        parent::__construct("Spotify rate limit hit; retry after {$retryAfter}s");
    }
}
