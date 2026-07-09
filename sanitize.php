<?php
// Shared input/output sanitizers for user- and LLM-supplied text that later
// gets rendered into HTML / CSS. These run on the WRITE path so that stored
// data is already safe; render-side escaping (htmlspecialchars / escapeHtml)
// stays as defense-in-depth.

// Strip HTML tags + control characters and cap length. For free-text fields
// (song titles, artist names) that flow into the DOM.
function nt_clean_text($s, int $maxLen = 300): string {
    if (!is_string($s)) {
        $s = is_scalar($s) ? (string) $s : '';
    }
    $s = strip_tags($s);
    // Guard the /u modifier: on invalid UTF-8 preg_replace returns null.
    $stripped = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $s);
    if ($stripped !== null) {
        $s = $stripped;
    }
    $s = trim($s);
    if (mb_strlen($s) > $maxLen) {
        $s = mb_substr($s, 0, $maxLen);
    }
    return $s;
}

// Small glyph field (e.g. an emoji icon): strip any markup and cap to a few
// codepoints so it can never carry an HTML payload.
function nt_safe_icon($s): string {
    return nt_clean_text($s, 8);
}

// Validate a CSS color value before it is interpolated into a style="..."
// attribute. Accepts #hex (3-8), rgb()/rgba()/hsl()/hsla() built from
// digits/commas/%/dots/spaces only, or a bare CSS named color. Anything else
// (e.g. `red" onmouseover=...` or `red);background:url(//evil`) returns the
// fallback, blocking attribute-breakout XSS and CSS injection.
function nt_safe_css_color($c, string $fallback = '#d4a574'): string {
    if (!is_string($c)) {
        return $fallback;
    }
    $c = trim($c);
    if (preg_match('/^#[0-9a-fA-F]{3,8}$/', $c)) {
        return $c;
    }
    if (preg_match('/^(rgb|rgba|hsl|hsla)\(\s*[0-9.,%\s]+\)$/i', $c)) {
        return $c;
    }
    if (preg_match('/^[a-zA-Z]{1,30}$/', $c)) {
        return $c;
    }
    return $fallback;
}
