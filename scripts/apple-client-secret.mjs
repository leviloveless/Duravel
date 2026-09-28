#!/usr/bin/env node
/**
 * Build the "Secret Key (for OAuth)" that Supabase's Apple provider needs.
 *
 * Apple does not issue a static client secret. It is a JWT you sign yourself
 * with the Sign in with Apple key (.p8), and Apple rejects one older than six
 * months — so this is re-run and the value re-pasted into Supabase twice a year.
 * No dependencies: Node's own crypto signs ES256.
 *
 * Usage (PowerShell or any shell, from the repo root):
 *   node scripts/apple-client-secret.mjs --p8 C:\\path\\AuthKey_ABC123XYZ9.p8 \
 *     --team F32S44TWS2 --key ABC123XYZ9 --client app.duravel.signin
 *
 *   --p8      the key file downloaded once from developer.apple.com → Keys
 *   --team    Apple Team ID (10 characters; Duravel's is F32S44TWS2)
 *   --key     the Key ID shown next to that key (10 characters)
 *   --client  the Services ID used for web sign-in (e.g. app.duravel.signin)
 *   --days    lifetime in days, 1–180 (default 180, Apple's maximum)
 *
 * Prints the JWT and the date it expires. Never commit the .p8 or the output.
 */
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";

export function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/**
 * @param {{ p8: string, teamId: string, keyId: string, clientId: string, days?: number, nowSec?: number }} opts
 * @returns {{ jwt: string, exp: number }}
 */
export function buildAppleClientSecret({ p8, teamId, keyId, clientId, days = 180, nowSec }) {
  if (!/^[A-Z0-9]{10}$/.test(teamId)) throw new Error("Team ID must be 10 letters/digits.");
  if (!/^[A-Z0-9]{10}$/.test(keyId)) throw new Error("Key ID must be 10 letters/digits.");
  if (!clientId || !clientId.includes("."))
    throw new Error("Client ID should be the Services ID, e.g. app.duravel.signin.");
  if (!(days >= 1 && days <= 180))
    throw new Error("Lifetime must be 1–180 days (Apple's limit is six months).");
  const iat = nowSec ?? Math.floor(Date.now() / 1000);
  const exp = iat + Math.floor(days * 86400);
  const header = { alg: "ES256", kid: keyId, typ: "JWT" };
  const payload = { iss: teamId, iat, exp, aud: "https://appleid.apple.com", sub: clientId };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = createPrivateKey(p8);
  const sig = sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
  return { jwt: `${input}.${b64url(sig)}`, exp };
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const isMain =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isMain) {
  try {
    const p8Path = arg("p8");
    if (!p8Path) throw new Error("Pass --p8 <path to AuthKey_XXXXXXXXXX.p8>.");
    const { jwt, exp } = buildAppleClientSecret({
      p8: readFileSync(p8Path, "utf8"),
      teamId: (arg("team") ?? "").trim(),
      keyId: (arg("key") ?? "").trim(),
      clientId: (arg("client") ?? "").trim(),
      days: arg("days") ? Number(arg("days")) : 180,
    });
    console.log(jwt);
    console.error(
      `\nExpires ${new Date(exp * 1000).toISOString().slice(0, 10)} — regenerate and re-paste into Supabase before then.`,
    );
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
