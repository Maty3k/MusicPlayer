<?php

namespace App\Support;

use RuntimeException;

/**
 * The Cloudflare Worker couldn't be used: it didn't answer, refused the
 * site's token, or answered something unexpected. The message is written for
 * the page; the status is what the proxy answers the browser with. Never a
 * 401: the page treats that as its own session ending.
 *
 * Deliberately carries no previous exception: the HTTP client's messages
 * include the Worker URL, and that URL carries the token.
 */
class CloudMusicUnavailable extends RuntimeException
{
    public function __construct(string $message, public readonly int $status = 502)
    {
        parent::__construct($message);
    }
}
