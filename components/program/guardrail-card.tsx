import type { GuardrailReport, GuardrailSeverity } from "@/lib/engine/guardrails";

/**
 * "Safety" tab — surfaces the guardrail analysis (injury / overtraining
 * patterns) for the generated program. Read-only: it explains the risk and how
 * to act; it never changes the plan.
 */

const SEV: Record<GuardrailSeverity, { dot: string; chip: string; label: string }> = {
  warn: { dot: "#dc2626", chip: "bg-red-50 text-red-700", label: "Watch" },
  info: { dot: "#d97706", chip: "bg-amber-50 text-amber-700", label: "Heads-up" },
};

export default function GuardrailCard({ report }: { report: GuardrailReport }) {
  if (report.clear) {
    return (
      <section className="rounded-2xl border border-zinc-200 bg-white p-6">
        <div className="flex items-center gap-3">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-full text-white"
            style={{ backgroundColor: "#0f766e" }}
            aria-hidden
          >
            ✓
          </span>
          <div>
            <h2 className="text-base font-semibold text-zinc-900">No safety flags</h2>
            <p className="text-sm text-zinc-500">
              Your progression, load ramp, and strength/endurance balance all look sensible.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const warns = report.flags.filter((f) => f.severity === "warn").length;

  return (
    <section className="flex flex-col gap-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Safety checks</h2>
        <p className="mt-1 text-sm text-zinc-600">
          {report.flags.length} thing{report.flags.length === 1 ? "" : "s"} worth a look
          {warns > 0 ? ` · ${warns} to watch` : ""}. These are advisory — informed by the training
          research, not automatic changes to your plan.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {report.flags.map((f, i) => {
          const s = SEV[f.severity];
          return (
            <div key={`${f.id}-${f.week}-${i}`} className="rounded-2xl border border-zinc-200 bg-white p-5">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.dot }} aria-hidden />
                <span className="font-semibold text-zinc-900">{f.title}</span>
                <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${s.chip}`}>
                  Week {f.week} · {s.label}
                </span>
              </div>
              <p className="mt-2 text-sm text-zinc-600">{f.detail}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
