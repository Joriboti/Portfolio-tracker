import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 30 };

// Dynamic-import diagnostic — every step is wrapped in a try/catch so the
// real error always reaches the response, even if the Neon driver fails
// to load on this runtime.
export default async function handler(
  _req: VercelRequest,
  res: VercelResponse,
) {
  let phase: string = "start";
  try {
    res.setHeader("Content-Type", "application/json");

    phase = "dynamic-import";
    const mod = await import("@neondatabase/serverless");

    phase = "env-check";
    const url = process.env.DATABASE_URL ?? "";
    if (!url) {
      res
        .status(500)
        .end(
          JSON.stringify({ ok: false, phase, error: "DATABASE_URL missing" }),
        );
      return;
    }

    phase = "client-init";
    const sql = mod.neon(url);

    phase = "query";
    const result = await sql`SELECT 1 AS ok`;

    res
      .status(200)
      .end(JSON.stringify({ ok: true, phase: "done", result }));
  } catch (e) {
    const err = e as Error;
    res.status(500).end(
      JSON.stringify({
        ok: false,
        phase,
        name: err?.name,
        message: err?.message,
        stack: err?.stack?.slice(0, 2000),
      }),
    );
  }
}
