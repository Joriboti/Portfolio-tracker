// Vercel's serverless build chokes when @neondatabase/serverless is imported
// at the top of an API route — the function crashes during cold-start with no
// JSON body (FUNCTION_INVOCATION_FAILED). Dynamic import sidesteps this and
// lets the rest of the function run normally. Discovered via /api/db-direct
// probe: dynamic import worked, static import crashed with the same code.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sql = any;

let _sql: Sql | null = null;

export async function getSql(): Promise<Sql> {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  const mod = await import("@neondatabase/serverless");
  _sql = mod.neon(url);
  return _sql;
}
