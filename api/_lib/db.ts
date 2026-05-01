import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  // Don't throw at module load — let routes throw on use so /api/_unrelated routes still work.
  // eslint-disable-next-line no-console
  console.warn("[db] DATABASE_URL is not set");
}

export const sql = neon(url ?? "");

export type SqlClient = typeof sql;
