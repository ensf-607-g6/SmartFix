"""Create the SmartFix schema (docs/System Design/DB Design/smartfix_schema_v2.sql) and load
demo data: Calgary service areas, crews and one account per role.

    python -m scripts.init_db            # load schema + seed into an empty database
    python -m scripts.init_db --reset    # drop everything first (destroys all data)
"""
import argparse
import asyncio
from pathlib import Path

import asyncpg

from app.auth import hash_password
from app.config import get_settings

REPO = Path(__file__).resolve().parents[2]
SCHEMA = REPO / "docs" / "System Design" / "DB Design" / "smartfix_schema_v2.sql"
DEMO_PASSWORD = "smartfix123"


def box(west: float, south: float, east: float, north: float) -> str:
    return (f"MULTIPOLYGON((({west} {south},{east} {south},{east} {north},"
            f"{west} {north},{west} {south})))")


# Calgary, split into quadrants at Centre Street / Centre Avenue, plus a downtown core.
AREAS = {
    "Downtown":       box(-114.100, 51.035, -114.040, 51.056),
    "Northwest":      box(-114.320, 51.0447, -114.0719, 51.215),
    "Northeast":      box(-114.0719, 51.0447, -113.850, 51.215),
    "Southwest":      box(-114.320, 50.840, -114.0719, 51.0447),
    "Southeast":      box(-114.0719, 50.840, -113.850, 51.0447),
}

USERS = [
    ("resident@smartfix.dev",       "Riley Resident",     "resident"),
    ("resident2@smartfix.dev",      "Sam Neighbour",      "resident"),
    ("operator@smartfix.dev",       "Olivia Operator",    "operator"),
    ("supervisor@smartfix.dev",     "Sasha Supervisor",   "supervisor"),
    ("crew.north@smartfix.dev",     "Noah (Roads North)", "crew"),
    ("crew.south@smartfix.dev",     "Sofia (Roads South)", "crew"),
    ("crew.lights@smartfix.dev",    "Liam (Lighting)",    "crew"),
    ("crew.water@smartfix.dev",     "Wren (Water)",       "crew"),
    ("crew.general@smartfix.dev",   "Gabe (General)",     "crew"),
]

ALL_AREAS = list(AREAS)
CREWS = [
    # name, member, max active orders, specialties, areas
    ("Roads Crew North", "crew.north@smartfix.dev", 5, ["pothole", "sidewalk_crack"],
     ["Downtown", "Northwest", "Northeast"]),
    ("Roads Crew South", "crew.south@smartfix.dev", 5, ["pothole", "sidewalk_crack"],
     ["Downtown", "Southwest", "Southeast"]),
    ("Street Lighting", "crew.lights@smartfix.dev", 6, ["streetlight"], ALL_AREAS),
    ("Water Services", "crew.water@smartfix.dev", 4, ["water_leak"], ALL_AREAS),
    ("General Maintenance", "crew.general@smartfix.dev", 8, ["other", "sidewalk_crack", "pothole"], ALL_AREAS),
]


async def main(reset: bool, dsn: str | None = None, quiet: bool = False) -> None:
    say = (lambda *_: None) if quiet else print
    conn = await asyncpg.connect(dsn or get_settings().database_url)
    try:
        exists = await conn.fetchval("SELECT to_regclass('public.issues') IS NOT NULL")
        if exists and not reset:
            say("Schema already exists. Use --reset to drop and recreate it (destroys all data).")
            return
        if reset:
            await conn.execute("SET client_min_messages = warning; DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
            say("dropped existing schema")
        await conn.execute("SET client_min_messages = warning;" + SCHEMA.read_text())
        say(f"loaded {SCHEMA.name}")

        async with conn.transaction():
            for name, wkt in AREAS.items():
                await conn.execute("INSERT INTO service_areas (name, boundary) VALUES ($1, ST_GeogFromText($2))",
                                   name, wkt)
            pw = hash_password(DEMO_PASSWORD)
            ids = {}
            for email, full_name, role in USERS:
                ids[email] = await conn.fetchval(
                    "INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, $4) RETURNING user_id",
                    email, pw, full_name, role)
            supervisor = ids["supervisor@smartfix.dev"]
            for name, member, cap, specialties, areas in CREWS:
                crew_id = await conn.fetchval(
                    "INSERT INTO crews (name, supervisor_id, max_active_orders) VALUES ($1, $2, $3) RETURNING crew_id",
                    name, supervisor, cap)
                await conn.execute("INSERT INTO crew_members (crew_id, user_id) VALUES ($1, $2)", crew_id, ids[member])
                await conn.execute(
                    """INSERT INTO crew_specialties (crew_id, problem_type_id)
                       SELECT $1, problem_type_id FROM problem_types WHERE code = ANY($2::text[])""",
                    crew_id, specialties)
                await conn.execute(
                    """INSERT INTO crew_service_areas (crew_id, area_id)
                       SELECT $1, area_id FROM service_areas WHERE name = ANY($2::text[])""", crew_id, areas)
        say(f"seeded {len(AREAS)} service areas, {len(USERS)} users, {len(CREWS)} crews")
        say(f"demo password for every account: {DEMO_PASSWORD}")
    finally:
        await conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--reset", action="store_true", help="drop and recreate the schema (destroys all data)")
    asyncio.run(main(parser.parse_args().reset))
