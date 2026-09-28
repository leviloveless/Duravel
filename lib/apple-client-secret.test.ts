import { describe, expect, it } from "vitest";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { buildAppleClientSecret } from "../scripts/apple-client-secret.mjs";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const p8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const decode = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

describe("Apple client secret for Supabase", () => {
  it("is an ES256 JWT with the claims Apple checks, signed so Apple can verify it", () => {
    const { jwt, exp } = buildAppleClientSecret({
      p8,
      teamId: "F32S44TWS2",
      keyId: "ABC123XYZ9",
      clientId: "app.duravel.signin",
      nowSec: 1_790_000_000,
    });
    const [h = "", p = "", s = ""] = jwt.split(".");
    expect(decode(h)).toEqual({ alg: "ES256", kid: "ABC123XYZ9", typ: "JWT" });
    expect(decode(p)).toEqual({
      iss: "F32S44TWS2",
      iat: 1_790_000_000,
      exp: 1_790_000_000 + 180 * 86400,
      aud: "https://appleid.apple.com",
      sub: "app.duravel.signin",
    });
    expect(exp).toBe(1_790_000_000 + 180 * 86400);
    const ok = verify(
      "sha256",
      Buffer.from(`${h}.${p}`),
      {
        key: createPublicKey(publicKey.export({ type: "spki", format: "pem" })),
        dsaEncoding: "ieee-p1363",
      },
      Buffer.from(s, "base64url"),
    );
    expect(ok).toBe(true);
  });
  it("refuses values Apple would reject", () => {
    const base = { p8, teamId: "F32S44TWS2", keyId: "ABC123XYZ9", clientId: "app.duravel.signin" };
    expect(() => buildAppleClientSecret({ ...base, days: 181 })).toThrow(/six months/);
    expect(() => buildAppleClientSecret({ ...base, teamId: "short" })).toThrow(/Team ID/);
    expect(() => buildAppleClientSecret({ ...base, keyId: "abc" })).toThrow(/Key ID/);
    expect(() => buildAppleClientSecret({ ...base, clientId: "" })).toThrow(/Services ID/);
  });
});
