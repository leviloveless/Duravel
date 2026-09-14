import type { Metadata } from "next";
import { LIBRARY } from "@/lib/library/workouts";
import { GOALS, type Goal } from "@/lib/library/types";
import LibraryBrowser from "@/components/library/library-browser";

export const metadata: Metadata = {
  title: "Workout library — Duravel",
  description:
    "Sessions filed by the adaptation they buy — aerobic base, threshold, VO2 max, durability, strength, power and hypertrophy.",
};

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ goal?: string }>;
}) {
  // The diagnostic links here with its verdict already applied. Validated
  // against the real goal list rather than trusted, so a hand-edited URL cannot
  // put the browser into a state with no matching filter chip.
  const params = await searchParams;
  const initialGoal = (GOALS as readonly string[]).includes(params.goal ?? "")
    ? (params.goal as Goal)
    : null;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-4xl font-bold tracking-wide uppercase">Workout library</h1>
        <p className="max-w-[64ch] text-zinc-600">
          Sessions you can drop into any week, filed by the adaptation they are trying to buy rather
          than the body part they use. The engine works from the same taxonomy, so anything you add
          from here gets periodized rather than bolted on.
        </p>
      </header>
      <div className="tick-tape" aria-hidden="true" />
      <LibraryBrowser workouts={LIBRARY} initialGoal={initialGoal} />
    </main>
  );
}
