"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { QUESTIONS, TESTS } from "@/lib/diagnostic/questions";
import { diagnose, parseClock } from "@/lib/diagnostic/score";
import type { AthleteContext, TestResults } from "@/lib/diagnostic/types";
import { GOAL_BLURB, GOAL_COLOR_VAR, GOAL_LABEL } from "@/lib/library/types";
import { LIBRARY } from "@/lib/library/workouts";

/**
 * The limiter diagnostic (2026-09-13).
 *
 * Three phases, and the athlete can stop after any of them. Questions are free
 * and immediate; the battery takes a week and is where the real signal is; the
 * result names a limiter and hands straight off to the library filtered by it.
 *
 * The result page shows its working. An athlete told "your limiter is aerobic
 * base" with no reasoning will not believe it, and should not — so every scored
 * limiter carries the measurements that put it there.
 */

type Phase = "questions" | "tests" | "result";

const FIELD =
  "rounded-md border border-line-strong px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none";

export default function DiagnosticTool({ ctx }: { ctx: AthleteContext }) {
  const [phase, setPhase] = useState<Phase>("questions");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [raw, setRaw] = useState<Record<string, string>>({});

  /** Parse the typed test inputs, dropping anything that is not yet a number. */
  const results = useMemo<TestResults>(() => {
    const out: TestResults = {};
    for (const t of TESTS) {
      const v = (raw[t.id] ?? "").trim();
      if (v === "") continue;
      const n = t.unit === "time" ? parseClock(v) : Number(v);
      if (n != null && Number.isFinite(n) && n > 0) {
        (out as Record<string, number>)[t.id] = n;
      }
    }
    return out;
  }, [raw]);

  const result = useMemo(() => diagnose(answers, results, ctx), [answers, results, ctx]);
  const answeredCount = Object.keys(answers).length;
  const testedCount = Object.keys(results).length;

  const top = result.ranked[0];
  const recommended = top ? LIBRARY.filter((w) => w.goal === top.limiter).slice(0, 3) : [];

  const tab = (p: Phase, label: string, meta: string) => (
    <button
      key={p}
      onClick={() => setPhase(p)}
      aria-current={phase === p ? "step" : undefined}
      className={`flex flex-col items-start gap-0.5 rounded-lg border px-4 py-2.5 text-left transition-colors ${
        phase === p
          ? "border-accent bg-accent-wash"
          : "border-line bg-white hover:border-line-strong"
      }`}
    >
      <span className="text-sm font-semibold">{label}</span>
      <span className="font-mono text-[10px] tracking-wide text-zinc-500 uppercase">{meta}</span>
    </button>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {tab("questions", "1 · Questions", `${answeredCount} of ${QUESTIONS.length} answered`)}
        {tab("tests", "2 · Test battery", `${testedCount} of ${TESTS.length} entered`)}
        {tab("result", "3 · Your limiter", result.confident ? "Ready" : "Needs more input")}
      </div>

      {phase === "questions" && (
        <section className="flex flex-col gap-5">
          <p className="max-w-[64ch] text-sm text-zinc-600">
            Eight questions, no equipment. These catch what a stopwatch cannot — where your race
            actually falls apart, and what you have not been doing. They are weighted below the
            measurements in step two, deliberately.
          </p>

          {QUESTIONS.map((q, i) => (
            <fieldset key={q.id} className="border-line flex flex-col gap-2 rounded-xl border p-4">
              <legend className="px-1 font-mono text-[10px] tracking-[0.14em] text-zinc-500 uppercase">
                Question {i + 1}
              </legend>
              <h3 className="text-[15px] font-semibold">{q.prompt}</h3>
              <p className="text-xs text-zinc-500">{q.why}</p>
              <div className="mt-1 flex flex-col gap-1.5">
                {q.options.map((o) => {
                  const active = answers[q.id] === o.id;
                  return (
                    <button
                      key={o.id}
                      onClick={() =>
                        setAnswers((a) =>
                          a[q.id] === o.id
                            ? Object.fromEntries(Object.entries(a).filter(([k]) => k !== q.id))
                            : { ...a, [q.id]: o.id },
                        )
                      }
                      aria-pressed={active}
                      className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                        active
                          ? "border-accent bg-accent-wash font-medium"
                          : "border-line hover:border-line-strong bg-white"
                      }`}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}

          <button
            onClick={() => setPhase("tests")}
            className="bg-accent hover:bg-accent-hi self-start rounded-md px-5 py-2.5 text-sm font-semibold text-white"
          >
            Next — the test battery
          </button>
        </section>
      )}

      {phase === "tests" && (
        <section className="flex flex-col gap-5">
          <div className="border-line rounded-xl border bg-amber-50 p-4 text-sm text-zinc-700">
            <b>Spread these across a week.</b> Two of them on one day measures your recovery, not
            your fitness. Every result is optional — enter what you have, come back for the rest.
          </div>

          {TESTS.map((t) => (
            <div key={t.id} className="border-line flex flex-col gap-2 rounded-xl border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[15px] font-semibold">{t.name}</h3>
                {t.needs && (
                  <span className="border-line rounded-full border bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-600">
                    Needs: {t.needs}
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-500">{t.measures}</p>

              <ol className="border-line flex list-decimal flex-col gap-1 rounded-lg border bg-zinc-50 py-2.5 pr-3 pl-7 text-[13px] leading-relaxed text-zinc-700">
                {t.protocol.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ol>

              <label className="flex items-center gap-2 text-xs font-semibold text-zinc-700">
                Result
                <input
                  value={raw[t.id] ?? ""}
                  onChange={(e) => setRaw((r) => ({ ...r, [t.id]: e.target.value }))}
                  placeholder={t.placeholder}
                  inputMode={t.unit === "time" ? "text" : "decimal"}
                  className={`${FIELD} w-32`}
                  aria-label={`${t.name} result`}
                />
                {t.unit === "percent" && <span className="text-xs text-zinc-500">%</span>}
              </label>
            </div>
          ))}

          <button
            onClick={() => setPhase("result")}
            className="bg-accent hover:bg-accent-hi self-start rounded-md px-5 py-2.5 text-sm font-semibold text-white"
          >
            See my limiter
          </button>
        </section>
      )}

      {phase === "result" && (
        <section className="flex flex-col gap-5">
          {!result.confident ? (
            <div className="border-line rounded-xl border bg-zinc-50 p-5">
              <h2 className="font-display text-xl font-bold tracking-wide uppercase">
                Not enough to call it yet
              </h2>
              <p className="mt-2 max-w-[62ch] text-sm text-zinc-600">
                Naming a limiter off a handful of answers would be worse than saying nothing — train
                the wrong quality for eight weeks and you have lost a block. Do{" "}
                <b>three of the tests</b>, or answer every question and do one test, and this page
                will commit to an answer.
              </p>
              <p className="mt-2 text-sm text-zinc-500">
                The fastest useful pair is the <b>5 km time trial</b> and the{" "}
                <b>aerobic decoupling</b> run.
              </p>
            </div>
          ) : (
            <>
              <div className="bg-brand flex flex-col gap-2 rounded-xl p-5 text-zinc-200">
                <span className="text-accent-hi font-mono text-[10px] tracking-[0.14em] uppercase">
                  Train this first
                </span>
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="h-4 w-4 shrink-0 rounded"
                    style={{ background: GOAL_COLOR_VAR[top!.limiter] }}
                  />
                  <h2 className="font-display text-3xl font-bold tracking-wide text-white uppercase">
                    {GOAL_LABEL[top!.limiter]}
                  </h2>
                </div>
                <p className="max-w-[60ch] text-sm text-zinc-400">{GOAL_BLURB[top!.limiter]}</p>
                <p className="mt-1 font-mono text-[11px] text-zinc-500">
                  Based on {testedCount} of {TESTS.length} tests and {answeredCount} of{" "}
                  {QUESTIONS.length} questions.
                </p>
              </div>

              <div className="border-line flex flex-col gap-3 rounded-xl border p-4">
                <h3 className="text-sm font-semibold">Why — the evidence, ranked</h3>
                {result.ranked
                  .filter((r) => r.score > 0)
                  .map((r) => (
                    <div key={r.limiter} className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                          style={{ background: GOAL_COLOR_VAR[r.limiter] }}
                        />
                        <span className="text-sm font-medium">{GOAL_LABEL[r.limiter]}</span>
                        <span className="ml-auto font-mono text-xs text-zinc-500">{r.score}</span>
                      </div>
                      <div
                        className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100"
                        role="img"
                        aria-label={`${GOAL_LABEL[r.limiter]} scores ${r.score} of 100`}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${r.score}%`, background: GOAL_COLOR_VAR[r.limiter] }}
                        />
                      </div>
                      <ul className="flex flex-col gap-1 pl-4 text-xs leading-relaxed text-zinc-600">
                        {r.reasons.map((why, i) => (
                          <li key={i} className="list-disc">
                            {why}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
              </div>

              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold">Start with these</h3>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3">
                  {recommended.map((w) => (
                    <article
                      key={w.id}
                      className="border-line flex flex-col gap-2 rounded-xl border bg-white p-4"
                    >
                      <h4 className="text-[15px] leading-snug font-semibold">{w.name}</h4>
                      <div className="flex flex-wrap gap-2 font-mono text-[11px] tracking-wide text-zinc-500 uppercase">
                        <span>{w.minutes} min</span>
                        <span aria-hidden>·</span>
                        <span>{w.phase} phase</span>
                      </div>
                      <p className="text-xs leading-relaxed text-zinc-500">{w.why}</p>
                    </article>
                  ))}
                </div>
                <Link
                  href={`/library?goal=${top!.limiter}`}
                  className="text-accent self-start text-sm font-semibold underline"
                >
                  Every {GOAL_LABEL[top!.limiter].toLowerCase()} session in the library
                </Link>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
