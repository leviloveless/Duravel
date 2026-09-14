import type { Metadata } from "next";
import { getCurrentProfile } from "@/lib/supabase/queries";
import DiagnosticTool from "@/components/diagnostic/diagnostic-tool";

export const metadata: Metadata = {
  title: "Find your limiter — Duravel",
  description:
    "A questionnaire and a test battery that identify which quality is actually costing you time.",
};

export default async function DiagnosticPage() {
  // Signed out is fine — the diagnostic is pure client-side maths and works as a
  // public tool. A signed-in athlete just gets their body weight and height
  // filled in, which is what turns a squat number into a ratio.
  const profile = await getCurrentProfile().catch(() => null);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-[10px] tracking-[0.14em] text-zinc-500 uppercase">
          Diagnostic
        </p>
        <h1 className="font-display text-4xl font-bold tracking-wide uppercase">
          What is actually costing you time?
        </h1>
        <p className="max-w-[64ch] text-zinc-600">
          Most athletes train the quality they enjoy and call it a plan. This works out which of the
          seven trainable qualities is your limiter — from what you know about your own racing, and
          from a battery of tests you can run in a week. The answer is a filter you can apply
          directly to the workout library.
        </p>
      </header>
      <div className="tick-tape" aria-hidden="true" />

      <DiagnosticTool
        ctx={{
          sex: profile?.sex ?? null,
          bodyWeight: profile?.body_weight ?? null,
          heightIn: profile?.height_in ?? null,
        }}
      />
    </main>
  );
}
