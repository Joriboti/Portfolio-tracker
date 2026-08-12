// Types for scripts/gen-vercel.mjs — generates vercel.json's routing blocks
// from the route inventory. src/lib/vercel-config.test.ts asserts the committed
// file matches what these produce.

export type Redirect = {
  source: string;
  destination: string;
  permanent: boolean;
  has?: { type: "query"; key: string; value: string }[];
};

export type Rewrite = { source: string; destination: string };

export function buildRedirects(): Redirect[];
export function buildRewrites(): Rewrite[];
export function buildConfig(current: Record<string, unknown>): Record<string, unknown>;
