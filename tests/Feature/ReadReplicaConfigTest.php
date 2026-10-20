<?php

namespace Tests\Feature;

use App\Providers\AppServiceProvider;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * On Laravel Cloud, Laravel 13.38 points reads at a read replica when
 * DB_READ_HOST is set, filling in only the 'read' half of the connection
 * and of its pgsql-unpooled copy. That half alone can't be built, so the
 * app ignores it, as 13.19 did.
 */
class ReadReplicaConfigTest extends TestCase
{
    private function connection(): string
    {
        return 'database.connections.'.config('database.default');
    }

    public function test_a_read_half_without_a_write_half_is_ignored_on_every_connection(): void
    {
        config([
            $this->connection().'.read' => ['host' => 'replica.invalid'],
            'database.connections.pgsql-unpooled' => ['driver' => 'pgsql', 'host' => 'primary.invalid', 'read' => ['host' => 'replica.invalid']],
        ]);

        (new AppServiceProvider($this->app))->register();
        DB::purge();

        $this->assertNull(config($this->connection().'.read'));
        $this->assertNull(config('database.connections.pgsql-unpooled.read'));
        $this->assertSame(1, (int) DB::selectOne('select 1 as one')->one);
    }

    public function test_a_connection_that_describes_both_halves_is_left_alone(): void
    {
        config([
            $this->connection().'.read' => ['host' => 'replica.invalid'],
            $this->connection().'.write' => ['host' => 'primary.invalid'],
        ]);

        (new AppServiceProvider($this->app))->register();

        $this->assertSame(['host' => 'replica.invalid'], config($this->connection().'.read'));
    }
}
