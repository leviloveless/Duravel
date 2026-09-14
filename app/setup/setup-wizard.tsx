"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { finishSetup, saveAbout, saveBenchmarks, type SetupState } from "./actions";

/**
 * Five-step account setup (2026-09-13).
 *
 * ⚠️ Step 3 is BENCHMARKS, not device pairing — a deliberate divergence from the
 * flow this was modelled on. A watch is a nice-to-have; a benchmark is the thing
 * the engine cannot run without. Without one it has to assume a starting point,
 * and every pace it then prescribes inherits that assumption silently.
 *
 * Every step is skippable and every step saves on its own (see actions.ts).
 */

const STEPS = ["Welcome", "About you", "Benchmarks", "Connect", "Done"] as const;

const initial: SetupState = { error: null, saved: false };

const FIELD =
  "rounded-md border border-line-strong px-3 py-2.5 font-mono focus:border-accent focus:outline-none";
const LABEL = "text-xs font-semibold text-zinc-700";
const HINT = "text-[11px] leading-snug text-zinc-500";

export type SetupInitial = {
  age: string;
  bodyWeight: string;
  weightUnit: string;
  heightIn: string;
  restingHr: string;
  fiveKTime: string;
  mileTime: string;
  row2kTime: string;
  ski2kTime: string;
  fiveRmSquat: string;
};

function Steps({ step, onPick }: { step: number; onPick: (i: number) => void }) {
  return (
    <div className="flex items-center" role="group" aria-label="Setup progress">
      {STEPS.map((label, i) => {
        const state = i < step ? "done" : i === step ? "now" : "next";
        return (
          <div key={label} className="flex flex-none items-center">
            <button
              type="button"
              onClick={() => onPick(i)}
              aria-current={state === "now" ? "step" : undefined}
              className="flex items-center gap-2"
            >
              <span
                className={`grid h-6 w-6 flex-none place-items-center rounded-full border-[1.5px] font-mono text-[11px] font-semibold ${
                  state === "done"
                    ? "border-accent bg-accent text-white"
                    : state === "now"
                      ? "border-accent text-accent ring-accent-wash ring-[3px]"
                      : "border-line-strong bg-white text-zinc-400"
                }`}
              >
                {state === "done" ? "✓" : i + 1}
              </span>
              <span
                className={`hidden text-[11px] font-semibold sm:inline ${state === "now" ? "text-zinc-900" : "text-zinc-500"}`}
              >
                {label}
              </span>
            </button>
            {i < STEPS.length - 1 && (
              <span
                aria-hidden
                className={`mx-2 h-[9px] w-6 bg-[length:100%_9px] bg-repeat-x sm:w-12 ${
                  i < step
                    ? "bg-[repeating-linear-gradient(90deg,var(--color-accent)_0_1px,transparent_1px_6px)]"
                    : "bg-[repeating-linear-gradient(90deg,var(--color-line-strong)_0_1px,transparent_1px_6px)]"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function SetupWizard({
  firstName,
  initial: init,
  hasHyroxSplits,
  strava,
  oura,
}: {
  firstName: string | null;
  initial: SetupInitial;
  hasHyroxSplits: boolean;
  strava: boolean;
  oura: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [aboutState, aboutAction, aboutPending] = useActionState(saveAbout, initial);
  const [markState, markAction, markPending] = useActionState(saveBenchmarks, initial);

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  async function done() {
    await finishSetup();
    router.push("/start");
  }

  return (
    <div className="flex flex-col gap-6">
      <Steps step={step} onPick={setStep} />

      {step === 0 && (
        <section className="flex flex-col gap-4">
          <p className="font-mono text-[10px] tracking-[0.14em] text-zinc-500 uppercase">
            Step 1 · welcome
          </p>
          <h1 className="font-display text-3xl font-bold tracking-wide uppercase">
            {firstName ? `You're in, ${firstName}.` : "You're in."} Here&rsquo;s what happens next.
          </h1>
          <p className="max-w-[62ch] text-zinc-600">
            Four short steps — about two minutes. Everything here can be changed later from your
            profile, and skipping a step never blocks you from building a program.
          </p>

          <div className="border-line grid grid-cols-1 items-center gap-5 rounded-xl border bg-zinc-50 p-5 sm:grid-cols-[auto_1fr]">
            <div className="border-line-strong h-[132px] w-[132px] rounded-lg border bg-white p-2">
              <Image
                src="/ios-qr.svg"
                alt="QR code linking to duravel.app/ios"
                width={132}
                height={132}
                className="h-full w-full"
                unoptimized
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="bg-accent-wash text-accent self-start rounded-full px-2.5 py-0.5 text-[11px] font-semibold">
                iOS beta · not shipped yet
              </span>
              <b className="text-base">Get the app when it lands</b>
              <p className="max-w-[44ch] text-sm text-zinc-600">
                Scan to join the TestFlight list. The app will carry your program offline, read
                workouts from Apple Health, and push the session reminder on the morning of — the
                web app stays fully featured either way.
              </p>
              <span className="font-mono text-[11px] text-zinc-500">duravel.app/ios</span>
            </div>
          </div>
        </section>
      )}

      {step === 1 && (
        <form action={aboutAction} className="flex flex-col gap-4">
          <p className="font-mono text-[10px] tracking-[0.14em] text-zinc-500 uppercase">
            Step 2 · about you
          </p>
          <h1 className="font-display text-3xl font-bold tracking-wide uppercase">
            The numbers everything is computed from.
          </h1>
          <p className="max-w-[62ch] text-zinc-600">
            Heart-rate zones, running paces and every prescribed load come out of these. Rough is
            fine — the engine re-fits as soon as you log real sessions.
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className={LABEL} htmlFor="s-weight">
                Body weight
              </label>
              <div className="flex gap-2">
                <input
                  id="s-weight"
                  name="bodyWeight"
                  defaultValue={init.bodyWeight}
                  inputMode="decimal"
                  placeholder="181"
                  className={`${FIELD} flex-1`}
                />
                <select
                  name="weightUnit"
                  defaultValue={init.weightUnit}
                  aria-label="Weight unit"
                  className={FIELD}
                >
                  <option value="lbs">lbs</option>
                  <option value="kg">kg</option>
                </select>
              </div>
              <span className={HINT}>Sets sled and carry loads relative to you.</span>
            </div>

            <div className="flex flex-col gap-1">
              <label className={LABEL} htmlFor="s-height">
                Height (inches)
              </label>
              <input
                id="s-height"
                name="heightIn"
                defaultValue={init.heightIn}
                inputMode="decimal"
                placeholder="72"
                className={FIELD}
              />
              <span className={HINT}>Used by the lunge and wall-ball standards.</span>
            </div>

            <div className="flex flex-col gap-1 sm:col-span-2">
              <label className={LABEL} htmlFor="s-rhr">
                Resting heart rate
              </label>
              <input
                id="s-rhr"
                name="restingHr"
                defaultValue={init.restingHr}
                inputMode="numeric"
                placeholder="48"
                className={`${FIELD} sm:max-w-[12rem]`}
              />
              <span className={HINT}>
                Optional, and the single most valuable box here. With it, your zones use heart-rate
                reserve instead of an age-based max-HR estimate — noticeably more accurate.
              </span>
            </div>
          </div>

          {aboutState.error && (
            <p className="text-sm text-red-600" role="alert">
              {aboutState.error}
            </p>
          )}
          {aboutState.saved && !aboutState.error && (
            <p className="text-sm text-emerald-700">Saved.</p>
          )}

          <button
            type="submit"
            disabled={aboutPending}
            className="bg-accent hover:bg-accent-hi self-start rounded-md px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {aboutPending ? "Saving…" : "Save"}
          </button>
        </form>
      )}

      {step === 2 && (
        <form action={markAction} className="flex flex-col gap-4">
          <p className="font-mono text-[10px] tracking-[0.14em] text-zinc-500 uppercase">
            Step 3 · benchmarks
          </p>
          <h1 className="font-display text-3xl font-bold tracking-wide uppercase">
            Where you are right now.
          </h1>
          <p className="max-w-[62ch] text-zinc-600">
            This is the step that matters. Without at least one of these the engine has to assume a
            starting point, and every pace it prescribes inherits that assumption.
          </p>

          <div className="border-line flex flex-col gap-3 rounded-xl border bg-zinc-50 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <b className="text-sm">Raced a HYROX before?</b>
              {hasHyroxSplits ? (
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800">
                  Splits already imported
                </span>
              ) : (
                <span className="bg-accent-wash text-accent rounded-full px-2.5 py-0.5 text-[11px] font-semibold">
                  Fastest path
                </span>
              )}
            </div>
            <p className="text-sm text-zinc-600">
              Search the public results and we import all eight station splits, your roxzone and
              your finish in one go — far better than anything you can type here.
            </p>
            <Link
              href="/tools/hyrox-lookup"
              className="border-line-strong self-start rounded-md border bg-white px-4 py-2 text-sm font-semibold hover:bg-zinc-50"
            >
              Find my result
            </Link>
          </div>

          <div className="flex items-center gap-3 text-xs text-zinc-400">
            <span className="h-px flex-1 bg-zinc-200" />
            or enter what you know
            <span className="h-px flex-1 bg-zinc-200" />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {(
              [
                ["fiveKTime", "Recent 5 km", "21:40", init.fiveKTime],
                ["mileTime", "Best mile", "6:12", init.mileTime],
                ["row2kTime", "2 km row", "7:12", init.row2kTime],
                ["ski2kTime", "2 km ski", "7:48", init.ski2kTime],
              ] as const
            ).map(([name, label, ph, val]) => (
              <div key={name} className="flex flex-col gap-1">
                <label className={LABEL} htmlFor={`s-${name}`}>
                  {label}
                </label>
                <input
                  id={`s-${name}`}
                  name={name}
                  defaultValue={val}
                  placeholder={ph}
                  className={FIELD}
                />
              </div>
            ))}
            <div className="flex flex-col gap-1">
              <label className={LABEL} htmlFor="s-squat">
                Back squat 5RM
              </label>
              <input
                id="s-squat"
                name="fiveRmSquat"
                defaultValue={init.fiveRmSquat}
                inputMode="decimal"
                placeholder="140"
                className={FIELD}
              />
              <span className={HINT}>In the same unit as your body weight.</span>
            </div>
          </div>

          {markState.error && (
            <p className="text-sm text-red-600" role="alert">
              {markState.error}
            </p>
          )}
          {markState.saved && !markState.error && (
            <p className="text-sm text-emerald-700">Saved.</p>
          )}

          <button
            type="submit"
            disabled={markPending}
            className="bg-accent hover:bg-accent-hi self-start rounded-md px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {markPending ? "Saving…" : "Save"}
          </button>
        </form>
      )}

      {step === 3 && (
        <section className="flex flex-col gap-4">
          <p className="font-mono text-[10px] tracking-[0.14em] text-zinc-500 uppercase">
            Step 4 · connect
          </p>
          <h1 className="font-display text-3xl font-bold tracking-wide uppercase">
            Bring your training data in.
          </h1>
          <p className="max-w-[62ch] text-zinc-600">
            Connected sessions are matched to your plan automatically, so adherence and next
            week&rsquo;s adaptation happen without you logging anything by hand.
          </p>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2.5">
            {(
              [
                ["Strava", strava ? "Connected" : "Runs, rides, lifts", true],
                ["Oura", oura ? "Connected" : "Sleep & readiness", true],
                ["Apple Health", "Ships with the iOS app", false],
                ["Garmin", "Program closed to new apps", false],
                ["WHOOP", "In review", false],
              ] as const
            ).map(([name, meta, enabled]) => (
              <div
                key={name}
                className={`border-line-strong flex flex-col gap-0.5 rounded-lg border p-3.5 ${
                  enabled ? "bg-white" : "bg-zinc-50 opacity-60"
                }`}
              >
                <span className="text-sm font-semibold">{name}</span>
                <span className="text-[11px] text-zinc-500">{meta}</span>
              </div>
            ))}
          </div>

          <Link
            href="/settings/connections"
            className="border-line-strong self-start rounded-md border px-4 py-2 text-sm font-semibold hover:bg-zinc-50"
          >
            Manage connections
          </Link>

          <p className="bg-accent-wash rounded-lg px-3.5 py-3 text-sm text-zinc-700">
            Nothing here is required. Athletes who log by hand get the same adaptation — it just
            takes thirty seconds a session.
          </p>
        </section>
      )}

      {step === 4 && (
        <section className="flex flex-col gap-4">
          <p className="font-mono text-[10px] tracking-[0.14em] text-zinc-500 uppercase">
            Step 5 · ready
          </p>
          <h1 className="font-display text-3xl font-bold tracking-wide uppercase">
            Set up. Now build the block.
          </h1>
          <p className="max-w-[62ch] text-zinc-600">
            A few questions about your race, your available week and your constraints, and the
            engine periodizes the whole thing — mesocycles, deloads, taper, race week.
          </p>
          <button
            type="button"
            onClick={done}
            className="bg-accent hover:bg-accent-hi self-start rounded-md px-6 py-3 font-semibold text-white"
          >
            Finish setup
          </button>
        </section>
      )}

      <div className="border-line mt-2 flex items-center gap-3 border-t pt-5">
        {step < STEPS.length - 1 && (
          <button type="button" onClick={next} className="text-sm text-zinc-500 hover:text-black">
            Skip for now
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={back}
            disabled={step === 0}
            className="border-line-strong rounded-md border px-4 py-2 text-sm font-semibold disabled:opacity-40"
          >
            Back
          </button>
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={next}
              className="bg-accent hover:bg-accent-hi rounded-md px-5 py-2 text-sm font-semibold text-white"
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              onClick={done}
              disabled={markPending}
              className="bg-accent hover:bg-accent-hi rounded-md px-5 py-2 text-sm font-semibold text-white"
            >
              Done — choose how I train
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
