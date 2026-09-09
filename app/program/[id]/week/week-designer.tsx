"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveWeekTemplate, clearWeekTemplate } from "./actions";
import WeekGrid from "@/components/program/week-grid";
import type { TemplateContext, TemplateIssue } from "@/lib/engine/template-validate";
import type { WeekTemplate } from "@/lib/engine/types";

/**
 * The week designer ON an existing program: the grid, plus what "save" means
 * here — write the template to the program's inputs and rebuild it.
 *
 * Everything above the buttons is `WeekGrid`, shared with the onboarding wizard
 * (Levi, 2026-09-09). What is left in this file is exactly the part the two
 * surfaces do NOT share: onboarding has no program to save against yet, and
 * carries its template into the first generate instead.
 */
export default function WeekDesigner({
  programId,
  initial,
  context,
  includeHybrid,
}: {
  programId: string;
  initial: WeekTemplate | null;
  context: TemplateContext;
  includeHybrid: boolean;
}) {
  const [template, setTemplate] = useState<WeekTemplate>({ days: [] });
  const [issues, setIssues] = useState<TemplateIssue[]>([]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  const blocking = issues.filter((i) => i.severity === "blocking");
  const sessionCount = template.days.reduce((n, d) => n + d.sessions.length, 0);

  const save = () =>
    startTransition(async () => {
      setError(null);
      const res = await saveWeekTemplate(programId, template);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      router.push(`/program/${programId}`);
      router.refresh();
    });

  const reset = () =>
    startTransition(async () => {
      setError(null);
      const res = await clearWeekTemplate(programId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/program/${programId}`);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-8">
      <WeekGrid
        initial={initial}
        context={context}
        includeHybrid={includeHybrid}
        onChange={(t, i) => {
          setTemplate(t);
          setIssues(i);
          setSaved(false);
        }}
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending || blocking.length > 0 || sessionCount === 0}
          className="rounded-full bg-black px-6 py-3 text-sm text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
        >
          {pending ? "Saving…" : saved ? "Saved" : "Save week and rebuild"}
        </button>
        {initial && (
          <button
            type="button"
            onClick={reset}
            disabled={pending}
            className="rounded-full border border-zinc-300 px-6 py-3 text-sm transition-colors hover:border-zinc-500 disabled:opacity-50"
          >
            Go back to the engine&apos;s week
          </button>
        )}
        {blocking.length > 0 && (
          <span className="text-xs text-red-600">
            Fix the {blocking.length} blocking item{blocking.length === 1 ? "" : "s"} above to save.
          </span>
        )}
      </div>
    </div>
  );
}
