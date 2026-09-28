import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Broadcast history (2026-09-28). There is no broadcasts table: each send batch
 * is an `admin_audit_log` row (action `email.broadcast`) whose detail holds the
 * message itself, so a batch that stopped at the per-click limit can be resumed
 * with exactly the same text, and the log doubles as the send history.
 */

export type BroadcastRecord = {
  broadcastId: string;
  createdAt: string;
  segment: string;
  subject: string;
  paragraphs: string[];
  button: { label: string; url: string } | null;
  recipients: number;
  sentSoFar: number;
  remaining: number;
};

type Detail = Partial<{
  broadcast_id: string;
  segment: string;
  subject: string;
  paragraphs: string[];
  button: { label: string; url: string } | null;
  recipients: number;
  sent_so_far: number;
  remaining: number;
}>;

function toRecord(row: { created_at: string; detail: Detail | null }): BroadcastRecord | null {
  const d = row.detail ?? {};
  if (!d.broadcast_id || !d.subject || !Array.isArray(d.paragraphs)) return null;
  return {
    broadcastId: d.broadcast_id,
    createdAt: row.created_at,
    segment: d.segment ?? "all",
    subject: d.subject,
    paragraphs: d.paragraphs,
    button: d.button ?? null,
    recipients: d.recipients ?? 0,
    sentSoFar: d.sent_so_far ?? 0,
    remaining: d.remaining ?? 0,
  };
}

/** The latest batch of each recent broadcast, newest first. */
export async function recentBroadcasts(limit = 10): Promise<BroadcastRecord[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("admin_audit_log")
    .select("created_at, detail")
    .eq("action", "email.broadcast")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return [];
  const seen = new Set<string>();
  const out: BroadcastRecord[] = [];
  for (const row of (data ?? []) as { created_at: string; detail: Detail | null }[]) {
    const r = toRecord(row);
    if (!r || seen.has(r.broadcastId)) continue;
    seen.add(r.broadcastId);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

/** Keys already sent (or on their way) for this broadcast — the resume point. */
export async function alreadySentUserIds(broadcastId: string): Promise<Set<string>> {
  const admin = createAdminClient();
  const prefix = `broadcast:${broadcastId}:`;
  const { data } = await admin
    .from("email_sends")
    .select("dedup_key")
    .like("dedup_key", `${prefix}%`)
    .in("status", ["queued", "sent", "delivered", "opened", "clicked"]);
  return new Set(
    ((data ?? []) as { dedup_key: string }[]).map((r) => r.dedup_key.slice(prefix.length)),
  );
}
