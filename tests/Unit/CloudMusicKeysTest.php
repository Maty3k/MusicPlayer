<?php

namespace Tests\Unit;

use App\Support\CloudMusic;
use PHPUnit\Framework\TestCase;

// Which bucket keys the Cloudflare proxy passes on, and what an upload is named.
class CloudMusicKeysTest extends TestCase
{
    public function test_playable_keys_are_audio_files_with_sane_names(): void
    {
        $this->assertTrue(CloudMusic::isPlayableKey('ABBA - Waterloo - AbbaVEVO.mp3'));
        $this->assertTrue(CloudMusic::isPlayableKey('Folder/Ünïcödé # ? & %.M4A'));
        $this->assertTrue(CloudMusic::isPlayableKey('<img src=x onerror=alert(1)>.mp3'));

        $this->assertFalse(CloudMusic::isPlayableKey(''));
        $this->assertFalse(CloudMusic::isPlayableKey('page.html'));
        $this->assertFalse(CloudMusic::isPlayableKey('mp3'));
        $this->assertFalse(CloudMusic::isPlayableKey("two\nlines.mp3"));
        $this->assertFalse(CloudMusic::isPlayableKey("broken \xC3\x28 utf8.mp3"));
        $this->assertFalse(CloudMusic::isPlayableKey(str_repeat('a', 1021).'.mp3'));
    }

    public function test_files_are_served_as_audio_whatever_the_worker_says(): void
    {
        $this->assertSame('audio/mpeg', CloudMusic::typeFor('a.MP3'));
        $this->assertSame('audio/mp4', CloudMusic::typeFor('Folder/b.m4a'));
        $this->assertNull(CloudMusic::typeFor('c.html'));
    }

    public function test_an_upload_keeps_its_own_name_without_folders_or_control_characters(): void
    {
        $this->assertSame('My Song.mp3', CloudMusic::uploadKey('My Song.mp3'));
        $this->assertSame('Track.m4a', CloudMusic::uploadKey('C:\\Music\\Album/Track.m4a'));
        $this->assertSame('A B.mp3', CloudMusic::uploadKey("  A \t\n B.mp3  "));

        $this->assertNull(CloudMusic::uploadKey('song.wav'));
        $this->assertNull(CloudMusic::uploadKey('.mp3'));
        $this->assertNull(CloudMusic::uploadKey(''));
        $this->assertNull(CloudMusic::uploadKey(str_repeat('a', 200).'.mp3'));
    }
}
