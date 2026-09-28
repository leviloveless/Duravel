import { adminOrResponse } from "@/lib/admin-access";
import { exportAccountData } from "@/lib/admin-accounts";
import { recordAdminAction } from "@/lib/admin-audit";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Everything held on one athlete, as a JSON download — how a privacy access
 * request gets answered. Audited, because it is the most complete copy of one
 * person's data that leaves the app.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const admin = await adminOrResponse();
  if (admin instanceof Response) return admin;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });

  const data = await exportAccountData(id);
  if (!data) return new Response("Not found", { status: 404 });

  const email = ((data.account as { email?: string | null }).email ?? "account").replace(
    /[^a-z0-9@._-]+/gi,
    "_",
  );
  await recordAdminAction(createAdminClient(), admin, { id, email }, "account.export");

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="duravel-export-${email}-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
