import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// Lazy singleton — instantiating the Neon client at module load time means
// any failure (bad URL, runtime mismatch, ...) crashes the serverless function
// before the handler runs and Vercel returns FUNCTION_INVOCATION_FAILED with
// no JSON body. By deferring instantiation to first use inside the handler,
// the same error is caught by the handler's try/catch and returned as JSON.

let _sql: NeonQueryFunction<false, false> | null = null;

export function getSql(): NeonQueryFunction<false, false> {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  _sql = neon(url);
  return _sql;
}
