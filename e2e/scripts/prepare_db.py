"""Give the Playwright run a fresh, known database before the e2e backend starts.

    cd backend && .venv/bin/python ../e2e/scripts/prepare_db.py

1. creates the e2e database if it does not exist (default smartfix_e2e on the DATABASE_URL server),
2. drops and reloads schema v2 plus the demo seed (service areas, crews, one account per role),
3. raises every crew's workload limit so a long run never leaves issues waiting for a crew
   (the manual-dispatch test switches a crew off itself), and
4. empties the e2e photo folder.

It refuses to touch a database whose name does not end in _e2e or _test, so it can never wipe
your dev data. Run it from backend/ with the backend virtualenv (it reuses scripts/init_db.py).
"""
import asyncio
import os
import shutil
import sys
from pathlib import Path

import asyncpg

BACKEND = Path.cwd()
sys.path.insert(0, str(BACKEND))

from scripts.init_db import main as init_db  # noqa: E402  (needs backend/ on the path first)

E2E_CREW_CAPACITY = 50


async def prepare(dsn: str, storage_dir: Path | None) -> None:
    server, name = dsn.rsplit("/", 1)
    name = name.split("?", 1)[0]
    if not (name.endswith("_e2e") or name.endswith("_test")):
        sys.exit(f"refusing to reset '{name}': the e2e database name must end in _e2e or _test")

    admin = await asyncpg.connect(f"{server}/postgres")
    try:
        if not await admin.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", name):
            await admin.execute(f'CREATE DATABASE "{name}"')
            print(f"created database {name}")
    finally:
        await admin.close()

    await init_db(reset=True, dsn=dsn)

    conn = await asyncpg.connect(dsn)
    try:
        await conn.execute("UPDATE crews SET max_active_orders = $1, is_active = TRUE", E2E_CREW_CAPACITY)
    finally:
        await conn.close()
    print(f"crew capacity raised to {E2E_CREW_CAPACITY} for the e2e run")

    if storage_dir:
        if storage_dir.name != ".storage":
            sys.exit(f"refusing to empty {storage_dir}: expected the e2e/.storage folder")
        shutil.rmtree(storage_dir, ignore_errors=True)
        storage_dir.mkdir(parents=True, exist_ok=True)
        print(f"emptied {storage_dir}")


if __name__ == "__main__":
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        sys.exit("set DATABASE_URL to the e2e database (e.g. postgresql://localhost:5433/smartfix_e2e)")
    storage = os.environ.get("STORAGE_DIR")
    asyncio.run(prepare(dsn, Path(storage).resolve() if storage else None))
