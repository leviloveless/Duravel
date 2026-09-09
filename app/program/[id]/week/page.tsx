import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { GenerationInputSchema } from "@/lib/schemas";
import { hasTier } from "@/lib/subscription";
import { getSport } from "@/lib/engine/sports";
import { templateContextFor, storedTemplate } from "@/lib/program/week-template";
import WeekDesigner from "./week-designer";

export const metadata: Metadata = { title: "Design your week — Duravel" };

/**
 * Design the training week this program is built from (custom tier, Levi
 * 2026-09-08).
 *
 * Deliberately a page ON a program rather than a fork of the onboarding wizard.
 * The wizard already collects everything the engine needs — profile, benchmarks,
 * hours, race — and none of that changes for a custom program; only the weekly
 * SHAPE does. So the custom flow is "build a program, then design its week",
 * which also means the same surface serves an amendment halfway through a block.
 */
export default async function DesignWeekPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: program } = await supabase
    .from("programs")
    .select("id, name, start_date, input_snapshot")
    .eq("id", id)
    .single();

  if (!program) {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold">Program not found</h1>
        <Link href="/dashboard" className="text-sm underline">
          Back to dashboard
        </Link>
      </Shell>
    );
  }

  // Gate one of two. The other is in `/api/generate`, which is what actually
  // consumes a stored template — this one exists so the athlete meets a sentence
  // rather than a failed generate.
  if (!(await hasTier("custom"))) {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold tracking-tight">Design your own week</h1>
        <p className="max-w-xl text-zinc-600">
          Set out your training week day by day — which sessions, on which days — and the engine
          builds the whole program around it. It still handles the parts you should not have to: the
          mileage progression, deloads, the taper, race week, and how far any single session is
          allowed to jump. And where your week fights a training rule, it tells you which rule and
          why, then builds what you asked for anyway.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/pricing"
            className="rounded-full bg-black px-6 py-3 text-sm text-white transition-colors hover:bg-zinc-800"
          >
            See the custom plan
          </Link>
          <Link
            href={`/program/${id}`}
            className="rounded-full border border-zinc-300 px-6 py-3 text-sm transition-colors hover:border-zinc-500"
          >
            Back to program
          </Link>
        </div>
      </Shell>
    );
  }

  const parsed = GenerationInputSchema.safeParse(program.input_snapshot);
  if (!parsed.success) {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold">This program&apos;s inputs can&apos;t be read</h1>
        <p className="text-zinc-600">Try Recalculate from the program page first.</p>
        <Link href={`/program/${id}`} className="text-sm underline">
          Back to program
        </Link>
      </Shell>
    );
  }

  const input = parsed.data;
  const context = templateContextFor(input, program.start_date as string);
  const cfg = getSport(input.sport);

  return (
    <Shell wide>
      <header className="flex flex-col gap-3">
        <Link href={`/program/${id}`} className="text-sm text-zinc-500 underline">
          ← {program.name ?? "Back to program"}
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Design your week</h1>
        <p className="max-w-2xl text-zinc-600">
          Choose what happens on each day. The engine takes it from there — it sizes every session
          from your mileage target, moves the whole thing through base, build, peak and taper, and
          leaves race week to the taper protocol.
          {context.peakMileage !== undefined && (
            <>
              {" "}
              This program peaks at about{" "}
              <span className="font-medium text-zinc-900">{context.peakMileage} miles</span> a week.
            </>
          )}
        </p>
      </header>

      <WeekDesigner
        programId={id}
        initial={storedTemplate(program.input_snapshot)}
        context={context}
        includeHybrid={cfg.sessionCounts?.hybrid !== undefined}
      />
    </Shell>
  );
}

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <main
      className={`mx-auto flex ${wide ? "max-w-5xl" : "max-w-2xl"} flex-col gap-8 px-4 py-12 sm:px-6`}
    >
      {children}
    </main>
  );
}
