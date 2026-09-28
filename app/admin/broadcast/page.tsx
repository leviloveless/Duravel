import Link from "next/link";
import type { Metadata } from "next";
import { env } from "@/lib/env";
import { requireAdmin } from "@/lib/admin-access";
import { listAccounts } from "@/lib/admin-accounts";
import {
  BROADCAST_BATCH,
  BROADCAST_SEGMENTS,
  broadcastRecipients,
  isBroadcastId,
  postalAddressFrom,
} from "@/lib/admin-broadcast";
import { recentBroadcasts } from "@/lib/admin-broadcast-data";
import { emailEnabled } from "@/lib/email/resend";
import { AdminNav, Card, Eyebrow, fmtDateTime, one } from "../users/ui";
import BroadcastForm from "./broadcast-form";

export const metadata: Metadata = {
  title: "Email a group · Admin",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
// A full batch is ~250 sends spaced for Resend's rate limit: allow the action time.
export const maxDuration = 300;

function newBroadcastId(): string {
  return crypto.randomUUID();
}

/** Email a group of athletes (2026-09-28). Rules: lib/admin-broadcast.ts. */
export default async function BroadcastPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const [{ accounts }, history] = await Promise.all([listAccounts(), recentBroadcasts()]);

  const postal = postalAddressFrom(env.EMAIL_POSTAL_ADDRESS);
  const unsubReady = !!env.EMAIL_UNSUB_SECRET;
  const sending = emailEnabled();
  const locked = !postal || !unsubReady;

  const resumeId = one(sp.resume);
  const resume =
    resumeId && isBroadcastId(resumeId) ? history.find((h) => h.broadcastId === resumeId) : null;
  const broadcastId = resume?.broadcastId ?? newBroadcastId();
  const initial = resume
    ? {
        segment: resume.segment,
        subject: resume.subject,
        body: resume.paragraphs.join("\n\n"),
        buttonLabel: resume.button?.label ?? "",
        buttonUrl: resume.button?.url ?? "",
      }
    : { segment: "all", subject: "", body: "", buttonLabel: "", buttonUrl: "" };

  const segments = BROADCAST_SEGMENTS.map((s) => ({
    key: s.key,
    label: s.label,
    count: broadcastRecipients(accounts, s.key).length,
  }));

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-10">
      <AdminNav current="/admin/broadcast" />
      <div>
        <Eyebrow>Admin / Email a group</Eyebrow>
        <h1 className="font-display text-ink mt-1 text-3xl font-bold">Email a group</h1>
      </div>

      {!postal ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <b>Sending is locked until a postal address is set.</b> Group email is marketing mail, and
          the law (CAN-SPAM) requires a valid physical postal address in its footer — a street
          address, a USPS PO box, or a registered private mailbox. Add it in Vercel as{" "}
          <span className="font-mono">EMAIL_POSTAL_ADDRESS</span> and redeploy. The form stays open
          for drafting, but the send buttons stay off until then.
        </div>
      ) : (
        <p className="text-xs text-zinc-500">
          Footer address: <span className="text-zinc-700">{postal}</span>
        </p>
      )}
      {!unsubReady ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-mono">EMAIL_UNSUB_SECRET</span> is not set, so emails could not
          carry a one-click unsubscribe. Sending stays locked until it is.
        </div>
      ) : null}
      {!sending ? (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
          Email is switched off in this environment (EMAIL_ENABLED), so nothing will actually go
          out.
        </div>
      ) : null}

      <Card title={resume ? "Continue a broadcast" : "Compose"}>
        {resume ? (
          <p className="mb-3 text-sm text-zinc-600">
            {resume.sentSoFar} of {resume.recipients} sent so far. Sending again reaches only the
            people who haven&apos;t had it.{" "}
            <Link href="/admin/broadcast" className="underline">
              Start a new one instead
            </Link>
          </p>
        ) : null}
        <BroadcastForm
          broadcastId={broadcastId}
          initial={initial}
          segments={segments}
          locked={locked}
        />
        <p className="mt-3 text-xs text-zinc-500">
          Up to {BROADCAST_BATCH} per click. A bigger group finishes over several clicks; nobody
          gets it twice.
        </p>
      </Card>

      <Card title="Recent broadcasts">
        {history.length === 0 ? (
          <p className="text-sm text-zinc-500">None yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-100 text-sm">
            {history.map((h) => (
              <li
                key={h.broadcastId}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <span>
                  <span className="font-medium text-zinc-900">{h.subject}</span>
                  <span className="block text-xs text-zinc-500">
                    {fmtDateTime(h.createdAt)} · {h.segment} · {h.sentSoFar}/{h.recipients} sent
                  </span>
                </span>
                {h.remaining > 0 ? (
                  <Link
                    href={`/admin/broadcast?resume=${h.broadcastId}`}
                    className="text-accent underline"
                  >
                    Continue ({h.remaining} left)
                  </Link>
                ) : (
                  <Link
                    href={`/admin/broadcast?resume=${h.broadcastId}`}
                    className="text-zinc-500 underline"
                  >
                    Open
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
