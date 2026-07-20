"use client";

import { useState, useTransition } from "react";
import { updateFundraiser } from "@/app/admin/impact/actions";
import { dollarsToCents, centsToUsd } from "@/lib/fundraiser";
import { Button } from "@/components/ui/button";

/**
 * Admin fundraiser editor (#19) — set the title, tagline, donate link, goal, and
 * current raised amount for the public /impact tracker. Dollar inputs; converted
 * to integer cents on save.
 */
export default function FundraiserEditor({
  initial,
}: {
  initial: {
    title: string;
    tagline: string;
    donateUrl: string;
    goalDollars: string;
    raisedDollars: string;
  };
}) {
  const [title, setTitle] = useState(initial.title);
  const [tagline, setTagline] = useState(initial.tagline);
  const [donateUrl, setDonateUrl] = useState(initial.donateUrl);
  const [goal, setGoal] = useState(initial.goalDollars);
  const [raised, setRaised] = useState(initial.raisedDollars);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setMsg(null);
    const goalCents = dollarsToCents(goal);
    const raisedCents = dollarsToCents(raised);
    if (goalCents === null) {
      setMsg({ kind: "err", text: "Goal must be a dollar amount." });
      return;
    }
    if (raisedCents === null) {
      setMsg({ kind: "err", text: "Raised must be a dollar amount." });
      return;
    }
    start(async () => {
      const r = await updateFundraiser({ title, tagline, donateUrl, goalCents, raisedCents });
      setMsg(r.ok ? { kind: "ok", text: "Saved." } : { kind: "err", text: r.error });
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label="Title">
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm" />
      </Field>
      <Field label="Tagline">
        <input value={tagline} onChange={(e) => setTagline(e.target.value)} className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm" />
      </Field>
      <Field label="Donate link (URL)">
        <input value={donateUrl} onChange={(e) => setDonateUrl(e.target.value)} placeholder="https://…" className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Goal ($)">
          <input value={goal} onChange={(e) => setGoal(e.target.value)} inputMode="decimal" className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm" />
        </Field>
        <Field label="Raised so far ($)">
          <input value={raised} onChange={(e) => setRaised(e.target.value)} inputMode="decimal" className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm" />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="primary" size="sm" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {msg && (
          <span className={`text-xs ${msg.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</span>
        )}
        <span className="text-xs text-zinc-400">
          Preview:{" "}
          <a href="/impact" target="_blank" rel="noreferrer" className="underline">
            /impact
          </a>
        </span>
      </div>
      <p className="text-[11px] text-zinc-400">
        Current goal reads as {formatPreview(goal)} · raised {formatPreview(raised)}.
      </p>
    </div>
  );
}

function formatPreview(dollars: string): string {
  const c = dollarsToCents(dollars);
  return c == null ? "—" : `$${centsToUsd(c).toLocaleString()}`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</span>
      {children}
    </label>
  );
}
