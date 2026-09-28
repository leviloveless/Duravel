import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { endAnnouncement, publishAnnouncement } from "./actions";
import {
  AdminNav,
  Card,
  Chip,
  Eyebrow,
  Flash,
  btnCls,
  btnSecondaryCls,
  fmtDateTime,
  inputCls,
  labelCls,
  one,
} from "../users/ui";

export const metadata: Metadata = {
  title: "Announcements · Admin",
  robots: { index: false, follow: false },
};

type Row = {
  id: number;
  message: string;
  tone: "info" | "warning";
  link_url: string | null;
  active: boolean;
  ends_at: string | null;
  created_at: string;
};

/** The announcement athletes can see right now — same rule as the RLS read policy. */
function liveOf(rows: Row[]): Row | undefined {
  const now = Date.now();
  return rows.find((r) => r.active && (!r.ends_at || Date.parse(r.ends_at) > now));
}

export default async function AnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const { data, error } = await createAdminClient()
    .from("site_announcements")
    .select("id, message, tone, link_url, active, ends_at, created_at")
    .order("created_at", { ascending: false })
    .limit(10);
  const rows = (data as Row[] | null) ?? [];
  const live = liveOf(rows);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-6 py-10">
      <AdminNav current="/admin/announcements" />
      <div>
        <Eyebrow>Admin</Eyebrow>
        <h1 className="font-display text-ink mt-1 text-3xl font-bold">Announcements</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600">
          One message at a time, shown under the navigation bar to every signed-in athlete. They can
          close it; a new announcement shows again.
        </p>
      </div>
      <Flash ok={one(sp.ok)} error={one(sp.error)} />
      {error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Migration <span className="font-mono">0049_site_announcements.sql</span> hasn&apos;t been
          applied yet. Run it in the Supabase SQL editor.
        </div>
      ) : null}

      <Card
        title="Live now"
        aside={
          live ? (
            <form action={endAnnouncement}>
              <button type="submit" className={btnSecondaryCls}>
                Take it down
              </button>
            </form>
          ) : null
        }
      >
        {live ? (
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-center gap-2">
              <Chip tone={live.tone === "warning" ? "amber" : "blue"}>{live.tone}</Chip>
              <span className="text-xs text-zinc-500">
                since {fmtDateTime(live.created_at)}
                {live.ends_at ? ` · ends ${fmtDateTime(live.ends_at)}` : " · no end date"}
              </span>
            </div>
            <p className="text-zinc-900">{live.message}</p>
            {live.link_url ? (
              <p className="font-mono text-xs text-zinc-500">{live.link_url}</p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">Nothing is showing.</p>
        )}
      </Card>

      <Card title={live ? "Replace with a new announcement" : "Publish an announcement"}>
        <form action={publishAnnouncement} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="message" className={labelCls}>
              Message (280 characters max)
            </label>
            <textarea
              id="message"
              name="message"
              required
              maxLength={280}
              rows={2}
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="tone" className={labelCls}>
              Style
            </label>
            <select id="tone" name="tone" defaultValue="info" className={inputCls}>
              <option value="info">Info (teal)</option>
              <option value="warning">Warning (amber) — e.g. maintenance</option>
            </select>
          </div>
          <div>
            <label htmlFor="days" className={labelCls}>
              Take down after (days — blank = until you do)
            </label>
            <input id="days" name="days" type="number" min={1} max={365} className={inputCls} />
          </div>
          <div>
            <label htmlFor="link_url" className={labelCls}>
              Link (optional — /library or https://…)
            </label>
            <input id="link_url" name="link_url" className={inputCls} />
          </div>
          <div>
            <label htmlFor="link_label" className={labelCls}>
              Link text
            </label>
            <input
              id="link_label"
              name="link_label"
              placeholder="Learn more"
              className={inputCls}
            />
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className={btnCls}>
              {live ? "Publish and replace" : "Publish"}
            </button>
          </div>
        </form>
      </Card>

      {rows.length > 0 ? (
        <Card title="Recent">
          <ul className="flex flex-col divide-y divide-zinc-100 text-sm">
            {rows.map((r) => (
              <li key={r.id} className="py-2">
                <span className="text-zinc-900">{r.message}</span>
                <span className="block text-xs text-zinc-500">
                  {fmtDateTime(r.created_at)} · {r.tone}
                  {r.id === live?.id ? " · live" : ""}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </main>
  );
}
