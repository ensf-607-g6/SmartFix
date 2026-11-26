import pg from 'pg'
import { DATABASE_URL } from './env'

/**
 * Direct SQL for the few set-ups the API cannot express, such as taking a crew off duty so
 * an issue waits for manual dispatch. Only ever points at the e2e database.
 */
export async function withDb<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: DATABASE_URL })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

export async function setCrewActive(crewName: string, active: boolean): Promise<void> {
  await withDb((db) => db.query('UPDATE crews SET is_active = $2 WHERE name = $1', [crewName, active]))
}

export async function crewId(crewName: string): Promise<number> {
  return withDb(async (db) => {
    const { rows } = await db.query<{ crew_id: number }>('SELECT crew_id FROM crews WHERE name = $1', [crewName])
    if (!rows.length) throw new Error(`no crew named ${crewName}`)
    return rows[0].crew_id
  })
}

export async function workOrderAssignments(workOrderId: string): Promise<{ crew: string; reason: string | null }[]> {
  return withDb(async (db) => {
    const { rows } = await db.query<{ crew: string; reason: string | null }>(
      `SELECT c.name AS crew, a.reason FROM work_order_assignments a JOIN crews c ON c.crew_id = a.crew_id
       WHERE a.work_order_id = $1 ORDER BY a.assigned_at`,
      [workOrderId],
    )
    return rows
  })
}
