import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey } from "jose";

// The point of this file: api/_auth.ts guards every route that touches user
// data, and it is the one module that cannot be exercised against the real Neon
// Auth server from a laptop. Rather than ship it unverified, the whole
// verification path runs here for real — a genuine Ed25519 keypair, a real
// signed JWT, real jose verification — with only the JWKS *fetch* intercepted.
// That covers everything except the exact claim shape Neon emits.
//
// It did NOT catch the JWKS *path* being wrong, because the stub answered
// whatever the module asked for. That is the lesson in `serves the JWKS at the
// path Neon actually uses` below: a test double that agrees with your
// assumption cannot falsify it.
//
// Every test re-imports the module because the JWKS is cached at module scope
// (deliberately: it makes verification free across warm invocations).

const BASE = "https://auth.example.test";
// The path Neon Auth actually serves. Better Auth's own default (`/jwks`) 404s
// on a Neon instance — assuming it shipped an auth layer that rejected every
// login, so this constant is pinned by test rather than left to a library
// default drifting underneath us.
const JWKS_URL = `${BASE}/.well-known/jwks.json`;

// The live instance signs with Ed25519, not ES256. Both are exercised: EdDSA
// because that is what production uses, ES256 because a hardcoded algorithm
// assumption is exactly the kind of thing that only breaks on deploy.
const ALG = "EdDSA";

let publicJwks: { keys: unknown[] };
let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;

const KID = "test-key-1";
const OTHER_KID = "attacker-key";

beforeEach(async () => {
  const pair = await generateKeyPair(ALG, { extractable: true });
  const other = await generateKeyPair(ALG, { extractable: true });
  privateKey = pair.privateKey;
  otherPrivateKey = other.privateKey;

  // Only the legitimate key is published. The attacker's is not — that is what
  // makes the forgery test meaningful.
  publicJwks = {
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: KID, alg: ALG, use: "sig" }],
  };

  process.env.NEON_AUTH_URL = BASE;
  delete process.env.CRON_SECRET;
  delete process.env.VITE_NEON_AUTH_URL;
  delete process.env.NEON_AUTH_ISSUER;
  delete process.env.NEON_AUTH_AUDIENCE;

  vi.resetModules();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input instanceof URL ? input.href : input);
      if (url === JWKS_URL) {
        return new Response(JSON.stringify(publicJwks), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function importAuth() {
  return import("./_auth.js");
}

type Claims = { sub?: string; exp?: string | number; iss?: string; aud?: string };

async function mint(
  claims: Claims = {},
  opts: { key?: CryptoKey; kid?: string; alg?: string } = {},
) {
  const jwt = new SignJWT({})
    .setProtectedHeader({ alg: opts.alg ?? ALG, kid: opts.kid ?? KID })
    .setIssuedAt()
    .setExpirationTime(claims.exp ?? "15m");
  if (claims.sub !== undefined) jwt.setSubject(claims.sub);
  if (claims.iss) jwt.setIssuer(claims.iss);
  if (claims.aud) jwt.setAudience(claims.aud);
  return jwt.sign(opts.key ?? privateKey);
}

function req(headers: Record<string, string | undefined> = {}) {
  return { headers } as unknown as import("@vercel/node").VercelRequest;
}

/** Captures what a route would have answered. */
function fakeRes() {
  const out: { status: number | null; body: string | null; headers: Record<string, string> } = {
    status: null,
    body: null,
    headers: {},
  };
  return {
    res: {
      setHeader(name: string, value: string) {
        out.headers[name.toLowerCase()] = value;
      },
      status(n: number) {
        out.status = n;
        return {
          end(b: string) {
            out.body = b;
          },
        };
      },
    },
    out,
  };
}

describe("requireUserId", () => {
  it("accepts a valid token and returns its subject", async () => {
    const { requireUserId } = await importAuth();
    const token = await mint({ sub: "user_abc" });
    await expect(requireUserId(req({ authorization: `Bearer ${token}` }))).resolves.toBe(
      "user_abc",
    );
  });

  it("fetches the JWKS once and then verifies offline", async () => {
    const { requireUserId } = await importAuth();
    const a = await mint({ sub: "user_abc" });
    const b = await mint({ sub: "user_abc" });
    await requireUserId(req({ authorization: `Bearer ${a}` }));
    await requireUserId(req({ authorization: `Bearer ${b}` }));
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("is case-insensitive about the Bearer scheme", async () => {
    const { requireUserId } = await importAuth();
    const token = await mint({ sub: "user_abc" });
    await expect(requireUserId(req({ authorization: `bearer ${token}` }))).resolves.toBe(
      "user_abc",
    );
  });

  // --- the hole this module was written to close ---------------------------
  it("REJECTS a bare x-user-id header, the vulnerability it replaced", async () => {
    const { requireUserId, AuthError } = await importAuth();
    await expect(requireUserId(req({ "x-user-id": "someone-elses-id" }))).rejects.toThrow(
      AuthError,
    );
    await expect(requireUserId(req({ "x-user-id": "someone-elses-id" }))).rejects.toMatchObject({
      status: 401,
    });
  });

  it("rejects a token signed by a key that is not in the JWKS", async () => {
    const { requireUserId } = await importAuth();
    // Same kid as the real key, so the lookup succeeds and the SIGNATURE is
    // what fails — the case a kid-only check would wave through.
    const forged = await mint({ sub: "victim" }, { key: otherPrivateKey, kid: KID });
    await expect(requireUserId(req({ authorization: `Bearer ${forged}` }))).rejects.toMatchObject(
      { status: 401 },
    );
  });

  it("rejects a token whose kid is unknown", async () => {
    const { requireUserId } = await importAuth();
    const forged = await mint({ sub: "victim" }, { key: otherPrivateKey, kid: OTHER_KID });
    await expect(requireUserId(req({ authorization: `Bearer ${forged}` }))).rejects.toMatchObject(
      { status: 401 },
    );
  });

  it("rejects an expired token with a message the client can act on", async () => {
    const { requireUserId } = await importAuth();
    const stale = await mint({ sub: "user_abc", exp: Math.floor(Date.now() / 1000) - 120 });
    await expect(requireUserId(req({ authorization: `Bearer ${stale}` }))).rejects.toMatchObject({
      status: 401,
      message: "Session expired",
    });
  });

  it("rejects a token with no subject claim", async () => {
    const { requireUserId } = await importAuth();
    const token = await mint({});
    await expect(requireUserId(req({ authorization: `Bearer ${token}` }))).rejects.toMatchObject({
      status: 401,
    });
  });

  it("rejects an absurdly long subject, which is a malformed token", async () => {
    const { requireUserId } = await importAuth();
    const token = await mint({ sub: "x".repeat(129) });
    await expect(requireUserId(req({ authorization: `Bearer ${token}` }))).rejects.toMatchObject({
      status: 401,
    });
  });

  it.each([
    ["no header at all", {}],
    ["empty header", { authorization: "" }],
    ["scheme with no token", { authorization: "Bearer" }],
    ["whitespace token", { authorization: "Bearer    " }],
    ["wrong scheme", { authorization: "Basic abc" }],
    ["raw token, no scheme", { authorization: "abc.def.ghi" }],
  ])("rejects %s", async (_label, headers) => {
    const { requireUserId } = await importAuth();
    await expect(requireUserId(req(headers))).rejects.toMatchObject({ status: 401 });
  });

  it("rejects garbage in place of a JWT", async () => {
    const { requireUserId } = await importAuth();
    await expect(
      requireUserId(req({ authorization: "Bearer not-a-jwt" })),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe("the JWKS endpoint", () => {
  // The bug this file shipped on 2026-07-30: the module asked for `${base}/jwks`,
  // Better Auth's default, but Neon Auth serves the key set at the OIDC discovery
  // path and 404s on `/jwks`. Every login would have been rejected. Verified
  // against the live instance before pinning it here.
  it("serves the JWKS at the path Neon actually uses, not Better Auth's default", async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input instanceof URL ? input.href : input);
        asked.push(url);
        if (url === JWKS_URL) {
          return new Response(JSON.stringify(publicJwks), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("Not Found", { status: 404 });
      }),
    );
    const { requireUserId } = await importAuth();
    const token = await mint({ sub: "user_abc" });
    await expect(requireUserId(req({ authorization: `Bearer ${token}` }))).resolves.toBe(
      "user_abc",
    );
    expect(asked).toEqual([`${BASE}/.well-known/jwks.json`]);
    expect(asked).not.toContain(`${BASE}/jwks`);
  });

  it("answers 503, not 401, when the key set 404s", async () => {
    // A wrong URL is a misconfiguration. Reporting it as "Invalid session token"
    // sends you debugging the client instead of the env var — which is exactly
    // what happened.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not Found", { status: 404 })));
    const { requireUserId } = await importAuth();
    const token = await mint({ sub: "user_abc" });
    await expect(requireUserId(req({ authorization: `Bearer ${token}` }))).rejects.toMatchObject({
      status: 503,
    });
  });

  it("honours NEON_AUTH_JWKS_URL as an escape hatch", async () => {
    const override = "https://elsewhere.test/keys.json";
    process.env.NEON_AUTH_JWKS_URL = override;
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input instanceof URL ? input.href : input);
        asked.push(url);
        return new Response(JSON.stringify(publicJwks), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const { requireUserId } = await importAuth();
    const token = await mint({ sub: "user_abc" });
    await expect(requireUserId(req({ authorization: `Bearer ${token}` }))).resolves.toBe(
      "user_abc",
    );
    expect(asked).toEqual([override]);
    delete process.env.NEON_AUTH_JWKS_URL;
  });

  it("verifies ES256 too, so the algorithm is not silently pinned to EdDSA", async () => {
    const pair = await generateKeyPair("ES256", { extractable: true });
    publicJwks = {
      keys: [{ ...(await exportJWK(pair.publicKey)), kid: KID, alg: "ES256", use: "sig" }],
    };
    const { requireUserId } = await importAuth();
    const token = await mint({ sub: "user_abc" }, { key: pair.privateKey, alg: "ES256" });
    await expect(requireUserId(req({ authorization: `Bearer ${token}` }))).resolves.toBe(
      "user_abc",
    );
  });
});

describe("configuration", () => {
  it("answers 500, not 401, when the auth URL is missing", async () => {
    delete process.env.NEON_AUTH_URL;
    const { requireUserId } = await importAuth();
    const token = await mint({ sub: "user_abc" });
    await expect(requireUserId(req({ authorization: `Bearer ${token}` }))).rejects.toMatchObject({
      status: 500,
    });
  });

  it("falls back to VITE_NEON_AUTH_URL so an existing deployment keeps working", async () => {
    delete process.env.NEON_AUTH_URL;
    process.env.VITE_NEON_AUTH_URL = BASE;
    const { requireUserId } = await importAuth();
    const token = await mint({ sub: "user_abc" });
    await expect(requireUserId(req({ authorization: `Bearer ${token}` }))).resolves.toBe(
      "user_abc",
    );
  });

  it("tolerates a trailing slash on the auth URL", async () => {
    process.env.NEON_AUTH_URL = `${BASE}///`;
    const { requireUserId } = await importAuth();
    const token = await mint({ sub: "user_abc" });
    await expect(requireUserId(req({ authorization: `Bearer ${token}` }))).resolves.toBe(
      "user_abc",
    );
  });

  it("answers 503, not 401, when the auth server is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const { requireUserId } = await importAuth();
    const token = await mint({ sub: "user_abc" });
    // 401 here would sign every user out during a Neon outage.
    await expect(requireUserId(req({ authorization: `Bearer ${token}` }))).rejects.toMatchObject({
      status: 503,
    });
  });

  it("enforces the issuer only when NEON_AUTH_ISSUER is set", async () => {
    process.env.NEON_AUTH_ISSUER = "https://expected.issuer.test";
    const { requireUserId } = await importAuth();
    const wrong = await mint({ sub: "user_abc", iss: BASE });
    await expect(requireUserId(req({ authorization: `Bearer ${wrong}` }))).rejects.toMatchObject({
      status: 401,
    });
    const right = await mint({ sub: "user_abc", iss: "https://expected.issuer.test" });
    await expect(requireUserId(req({ authorization: `Bearer ${right}` }))).resolves.toBe(
      "user_abc",
    );
  });

  it("enforces the audience only when NEON_AUTH_AUDIENCE is set", async () => {
    process.env.NEON_AUTH_AUDIENCE = "adtrack";
    const { requireUserId } = await importAuth();
    const wrong = await mint({ sub: "user_abc", aud: "someone-else" });
    await expect(requireUserId(req({ authorization: `Bearer ${wrong}` }))).rejects.toMatchObject({
      status: 401,
    });
    const right = await mint({ sub: "user_abc", aud: "adtrack" });
    await expect(requireUserId(req({ authorization: `Bearer ${right}` }))).resolves.toBe(
      "user_abc",
    );
  });

  it("accepts a token with any issuer/audience when neither is configured", async () => {
    const { requireUserId } = await importAuth();
    const token = await mint({ sub: "user_abc", iss: "https://whatever.test", aud: "anything" });
    await expect(requireUserId(req({ authorization: `Bearer ${token}` }))).resolves.toBe(
      "user_abc",
    );
  });
});

describe("authenticate", () => {
  it("returns the id and writes nothing on success", async () => {
    const { authenticate } = await importAuth();
    const { res, out } = fakeRes();
    const token = await mint({ sub: "user_abc" });
    await expect(authenticate(req({ authorization: `Bearer ${token}` }), res)).resolves.toBe(
      "user_abc",
    );
    expect(out.status).toBeNull();
  });

  it("returns null and writes the status + reason on failure", async () => {
    const { authenticate } = await importAuth();
    const { res, out } = fakeRes();
    await expect(authenticate(req({}), res)).resolves.toBeNull();
    expect(out.status).toBe(401);
    expect(JSON.parse(out.body ?? "{}").error).toMatch(/Authorization/i);
  });

  it("passes the 503 through so a client can tell an outage from a sign-out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const { authenticate } = await importAuth();
    const { res, out } = fakeRes();
    const token = await mint({ sub: "user_abc" });
    await expect(authenticate(req({ authorization: `Bearer ${token}` }), res)).resolves.toBeNull();
    expect(out.status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// The compat rollout. These tests are the specification of the first deploy:
// nothing that works today may stop working, a valid JWT must always win, and
// every response must say which path identified the caller.
// ---------------------------------------------------------------------------

describe("authenticate ignores x-user-id entirely", () => {

  it("REJECTS a bare x-user-id header — the vulnerability, closed", async () => {
    const { authenticate } = await importAuth();
    const { res, out } = fakeRes();
    expect(await authenticate(req({ "x-user-id": "user_victim" }), res)).toBeNull();
    expect(out.status).toBe(401);
    expect(out.headers["x-auth-via"]).toBeUndefined();
  });

  it("rejects a forged token even with a matching x-user-id", async () => {
    const { authenticate } = await importAuth();
    const forged = await mint({ sub: "user_victim" }, { key: otherPrivateKey });
    const { res, out } = fakeRes();
    const id = await authenticate(
      req({ authorization: `Bearer ${forged}`, "x-user-id": "user_victim" }),
      res,
    );
    expect(id).toBeNull();
    expect(out.status).toBe(401);
  });

  it("still accepts a valid token", async () => {
    const { authenticate } = await importAuth();
    const token = await mint({ sub: "user_abc" });
    const { res, out } = fakeRes();
    expect(await authenticate(req({ authorization: `Bearer ${token}` }), res)).toBe("user_abc");
    expect(out.headers["x-auth-via"]).toBe("jwt");
  });
});

describe("cron-or-user routes", () => {
  const SECRET = "s3cr3t-cron-value";

  it("recognises the cron secret and runs for everyone", async () => {
    process.env.CRON_SECRET = SECRET;
    const { authenticateCronOrUser } = await importAuth();
    const { res, out } = fakeRes();
    const who = await authenticateCronOrUser(req({ authorization: `Bearer ${SECRET}` }), res);
    expect(who).toEqual({ cron: true, userId: null });
    expect(out.headers["x-auth-via"]).toBe("cron");
    // The secret is not a JWT: it must never reach the JWKS.
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("accepts a signed-in user and scopes the job to them", async () => {
    process.env.CRON_SECRET = SECRET;
    const { authenticateCronOrUser } = await importAuth();
    const token = await mint({ sub: "user_abc" });
    const { res } = fakeRes();
    expect(await authenticateCronOrUser(req({ authorization: `Bearer ${token}` }), res)).toEqual({
      cron: false,
      userId: "user_abc",
    });
  });

  it("an UNSET secret no longer means 'allow everyone'", async () => {
    // It used to: `const cronOk = !cronSecret || …`.
    const { authenticateCronOrUser, isCronRequest } = await importAuth();
    expect(isCronRequest(req({}))).toBe(false);
    expect(isCronRequest(req({ authorization: "Bearer undefined" }))).toBe(false);
    const { res, out } = fakeRes();
    expect(await authenticateCronOrUser(req({}), res)).toBeNull();
    expect(out.status).toBe(401);
  });

  it("rejects a wrong secret, a near miss and a missing scheme", async () => {
    process.env.CRON_SECRET = SECRET;
    const { isCronRequest } = await importAuth();
    for (const authz of [`Bearer ${SECRET}x`, `Bearer ${SECRET.slice(0, -1)}`, SECRET, "", "Bearer "]) {
      expect(isCronRequest(req({ authorization: authz })), authz).toBe(false);
    }
  });

  it("a bare x-user-id cannot start a job", async () => {
    process.env.CRON_SECRET = SECRET;
    const { authenticateCronOrUser } = await importAuth();
    const { res, out } = fakeRes();
    expect(await authenticateCronOrUser(req({ "x-user-id": "anyone" }), res)).toBeNull();
    expect(out.status).toBe(401);
  });
});

describe("a signed-in caller cannot act as somebody else", () => {
  it("uses the token's subject and ignores an x-user-id sent alongside it", async () => {
    const { authenticate } = await importAuth();
    const token = await mint({ sub: "user_real" });
    const { res, out } = fakeRes();
    const id = await authenticate(
      req({ authorization: `Bearer ${token}`, "x-user-id": "user_victim" }),
      res,
    );
    expect(id).toBe("user_real");
    expect(out.status).toBeNull();
  });

  it("no longer reports a legacy path", async () => {
    const { authenticate } = await importAuth();
    const { res, out } = fakeRes();
    expect(await authenticate(req({ "x-user-id": "user_abc" }), res)).toBeNull();
    expect(out.status).toBe(401);
    expect(out.headers["x-auth-via"]).toBeUndefined();
    expect(out.headers["x-auth-jwt-error"]).toBeUndefined();
  });
});
