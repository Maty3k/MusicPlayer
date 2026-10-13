<?php

/*
 | How much one account may hold. Accounts are free and instant, so without a
 | ceiling a script could fill the database through a single one. The numbers
 | sit far above any real library (see App\Support\LibraryLimits).
 */

return [

    // Playlists per account.
    'playlists' => 300,

    // Songs in one playlist, and in all of an account's playlists together.
    'playlist_songs' => 5000,
    'songs' => 30000,

    // Longest address a song may carry as its cover or its audio.
    'url_length' => 2000,

    // Distinct songs kept in an account's play history.
    'plays' => 20000,

];
