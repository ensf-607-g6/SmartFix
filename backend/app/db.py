"""Connection pool. Every write runs inside Database.transaction(module, event_id),
which sets app.module / app.event_id so the status-ownership trigger (NFR-4) can
check that only the owning module moves an issue."""
import json
from contextlib import asynccontextmanager
from typing import AsyncIterator
from uuid import UUID

import asyncpg

Transaction = asyncpg.Connection


async def _init_connection(conn: asyncpg.Connection) -> None:
    for name in ("json", "jsonb"):
        await conn.set_type_codec(name, encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


class Database:
    def __init__(self, dsn: str):
        self.dsn = dsn
        self.pool: asyncpg.Pool | None = None

    async def connect(self) -> None:
        self.pool = await asyncpg.create_pool(self.dsn, min_size=2, max_size=10, init=_init_connection)

    async def close(self) -> None:
        if self.pool:
            await self.pool.close()

    @asynccontextmanager
    async def transaction(self, module: str | None, event_id: UUID | None = None) -> AsyncIterator[Transaction]:
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                if module:
                    await conn.execute("SELECT set_config('app.module', $1, true)", module)
                if event_id:
                    await conn.execute("SELECT set_config('app.event_id', $1, true)", str(event_id))
                yield conn

    # Read helpers for routers that only query views (DashboardQueryAPI).
    async def fetch(self, sql: str, *args):
        async with self.pool.acquire() as conn:
            return await conn.fetch(sql, *args)

    async def fetchrow(self, sql: str, *args):
        async with self.pool.acquire() as conn:
            return await conn.fetchrow(sql, *args)

    async def fetchval(self, sql: str, *args):
        async with self.pool.acquire() as conn:
            return await conn.fetchval(sql, *args)
