"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveWeekTemplate, clearWeekTemplate, type SaveTemplateResult } from "./actions";
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

  /**
   * Save, then leave — and STOP SAYING "Saving…" the moment saving is done.
   *
   * This button used to sit on "Saving…" indefinitely (Levi, 2026-09-09). Three
   * things were wrong with it and only the first is obvious:
   *
   *  1. `router.push` and `router.refresh` were INSIDE `startTransition`, so
   *     `pending` stayed true until the destination finished rendering. The
   *     destination is a program that has just been reset to `generating`, which
   *     immediately fires a generation that can run for a minute — so the button
   *     honestly reported "Saving…" for the entire rebuild, long after the save
   *     itself had committed. `router.refresh()` on top of `router.push()` is
   *     redundant (the action already calls `revalidatePath`) and only widened
   *     the window.
   *  2. Nothing caught a THROW. The action returns its errors, but a network
   *     drop, a serialisation failure or a server exception rejects the promise
   *     instead — and an unhandled rejection inside a transition callback leaves
   *     `pending` stuck true with no message on screen. That is the same stuck
   *     button with none of the same cause, and it would have looked identical.
   *  3. The label described the wrong thing. Saving takes a moment; the REBUILD
   *     that follows is what the athlete actually waits for, and calling it
   *     "Saving" invites exactly the "is this stuck?" question it got.
   *
   * So: await the action inside the transition, navigate outside it, and never
   * leave without either an error or a destination.
   */
  const run = (act: () => Promise<SaveTemplateResult>) =>
    startTransition(async () => {
      setError(null);
      try {
        const res = await act();
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setSaved(true);
      } catch {
        setError("Something went wrong saving your week. Nothing was changed — please try again.");
        return;
      }
      // Outside the transition on purpose — see (1).
      router.push(`/program/${programId}`);
    });

  const save = () => run(() => saveWeekTemplate(programId, template));
  const reset = () => run(() => clearWeekTemplate(programId));

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
          {saved ? "Saved — rebuilding…" : pending ? "Saving…" : "Save week and rebuild"}
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
