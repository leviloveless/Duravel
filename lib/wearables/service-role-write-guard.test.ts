/**
 * REGRESSION — a user-scoped client must never write a service-role-only table
 * (Levi, 2026-08-17, found live).
 *
 * ## The bug this exists to prevent, in full
 *
 * `dismissSuggestion` shipped writing `wearable_activities` through the
 * request-scoped Supabase client:
 *
 *     const supabase = await createClient();          // the athlete's session
 *     await supabase.from("wearable_activities")
 *       .update({ suggestion_dismissed_at: ... })
 *       .eq("id", activityId).eq("user_id", user.id);
 *
 * It reads as careful — RLS is on, the write is filtered to the user's own row,
 * and the code review note said so. It wrote nothing. Migration 0016 gives that
 * table a SELECT policy and says, in a comment:
 *
 *     -- Writes are service-role only (sync job): no insert/update/delete policy.
 *
 * **With no UPDATE policy, RLS does not reject an update — it filters every row
 * out of it.** PostgREST reports that as success on zero rows. So the action
 * returned `{ ok: true }`, the HTTP response was 200, the card disappeared, and
 * the dismissal was back on the next page load. Nothing failed loudly anywhere:
 * not the action, not the network tab, not the console. It took a live
 * dismiss → reload → count to see it at all.
 *
 * That is the shape worth a guard. It is invisible in review (the code looks
 * more careful than the correct version), invisible at runtime, and every new
 * table added with the same service-role rule can reintroduce it.
 *
 * ## What is checked
 *
 * The restricted set is derived from the migrations, not hardcoded — a table is
 * write-restricted when RLS is enabled and no `insert`/`update`/`delete`/`all`
 * policy is ever created for it. Then every write callsite in `app/` and `lib/`
 * on such a table must be chained off `createAdminClient()`.
 *
 * Adding a write policy in a later migration takes its table out of the set
 * automatically, so this never becomes a rule that outlives its reason.
 *
 * ## What is NOT checked
 *
 * This reads source text, not types. It catches the exact shape that shipped —
 * a client from `createClient()` writing a restricted table in the same file —
 * and it does not follow a client passed between modules. Treat a pass as "the
 * obvious version of this mistake is absent", not as a proof.
 *
 * ## The fix it pins
 *
 * `dismissSuggestion` now writes with `createAdminClient()` and confines the row
 * with `.eq("user_id", user.id)` after `getUser()`. Not by adding a policy:
 * Postgres RLS cannot be scoped to one column, so a policy permissive enough to
 * set `suggestion_dismissed_at` would also let an athlete rewrite `duration_s`,
 * `distance_m` and `linked` — editing the provider's record of what they did.
 * Synced data is worth something precisely because the athlete cannot author it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const SOURCE_DIRS = ["app", "lib"];
const WRITE_METHODS = ["insert", "update", "upsert", "delete"] as const;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Tables that enable RLS but never receive a write policy. */
function writeRestrictedTables(): Set<string> {
  const rlsOn = new Set<string>();
  const hasWritePolicy = new Set<string>();

  for (const file of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    // Strip line comments so the prose in them can never be parsed as SQL.
    const bare = sql.replace(/^\s*--.*$/gm, "");

    for (const m of bare.matchAll(
      /alter\s+table\s+(?:public\.)?(\w+)\s+enable\s+row\s+level\s+security/gi,
    )) {
      rlsOn.add(m[1]!.toLowerCase());
    }
    for (const m of bare.matchAll(/create\s+policy\s+[^;]*?\son\s+(?:public\.)?(\w+)([^;]*);/gi)) {
      const table = m[1]!.toLowerCase();
      const body = m[2]!;
      const forClause = /\bfor\s+(select|insert|update|delete|all)\b/i.exec(body);
      // No `for` clause means ALL commands, which includes writes.
      const cmd = forClause ? forClause[1]!.toLowerCase() : "all";
      if (cmd !== "select") hasWritePolicy.add(table);
    }
  }

  const restricted = new Set<string>();
  for (const t of rlsOn) if (!hasWritePolicy.has(t)) restricted.add(t);
  return restricted;
}

type Callsite = { file: string; table: string; receiver: string; method: string };

/**
 * Every `<receiver>.from("<table>")` in `file` whose chain performs a write.
 * The receiver is the token immediately before `.from(` — either an inline
 * `createAdminClient()` or the variable a client was assigned to.
 */
function writeCallsites(file: string, tables: Set<string>): Callsite[] {
  const src = readFileSync(file, "utf8");
  const found: Callsite[] = [];
  const re = /(\w+\(\)|\w+)\s*\n?\s*\.\s*from\(\s*["'](\w+)["']\s*\)/g;
  for (const m of src.matchAll(re)) {
    const table = m[2]!.toLowerCase();
    if (!tables.has(table)) continue;
    // Look ahead within the same chain for a write method.
    const tail = src.slice(m.index! + m[0].length, m.index! + m[0].length + 400);
    const chain = tail.split(/;\s*\n/)[0] ?? tail;
    const method = WRITE_METHODS.find((w) => new RegExp(`\\.\\s*${w}\\s*\\(`).test(chain));
    if (!method) continue;
    found.push({ file: relative(ROOT, file), table, receiver: m[1]!, method });
  }
  return found;
}

const RESTRICTED = writeRestrictedTables();
const FILES = SOURCE_DIRS.flatMap((d) => walk(join(ROOT, d)));

describe("service-role-only tables are never written by a user-scoped client", () => {
  it("finds the restricted set from the migrations, and it includes wearable_activities", () => {
    // If this ever stops holding, a write policy was added to the table and the
    // whole premise of `dismissSuggestion`'s admin write should be revisited.
    expect(RESTRICTED.has("wearable_activities")).toBe(true);
    expect(RESTRICTED.size).toBeGreaterThan(0);
  });

  it("still sees the real callsites — the scanner is not silently matching nothing", () => {
    // A guard that finds zero callsites passes forever and protects nothing.
    const all = FILES.flatMap((f) => writeCallsites(f, RESTRICTED));
    expect(all.length).toBeGreaterThan(0);
    expect(all.some((c) => c.table === "wearable_activities")).toBe(true);
  });

  it("routes every write on a restricted table through createAdminClient()", () => {
    const offenders: string[] = [];

    for (const file of FILES) {
      const sites = writeCallsites(file, RESTRICTED);
      if (sites.length === 0) continue;

      const src = readFileSync(file, "utf8");
      const adminAliases = new Set<string>(["createAdminClient()"]);
      for (const m of src.matchAll(
        /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?createAdminClient\(\)/g,
      )) {
        adminAliases.add(m[1]!);
      }
      // Helpers that take the client in — `lib/push/reminders.ts` and the
      // unsubscribe route both do. A parameter typed `SupabaseClient` and NAMED
      // `admin*` is the repo's way of declaring "callers hand me the service-role
      // client"; that name is the contract, and it is what this accepts. See the
      // limits note above: this guard does not follow those params to their call
      // sites, so a helper named `admin` handed a user client stays invisible.
      for (const m of src.matchAll(/\b(admin\w*)\s*:\s*SupabaseClient\b/g)) {
        adminAliases.add(m[1]!);
      }

      for (const site of sites) {
        if (!adminAliases.has(site.receiver)) {
          offenders.push(
            `${site.file}: ${site.receiver}.from("${site.table}").${site.method}() — ` +
              `${site.table} has no write policy, so this silently updates ZERO rows ` +
              `and reports success. Use createAdminClient() and scope with .eq("user_id", user.id).`,
          );
        }
      }
    }

    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
