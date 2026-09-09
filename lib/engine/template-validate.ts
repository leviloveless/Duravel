/**
 * Reading an athlete's own training week back to them (Levi, 2026-09-08).
 *
 * The custom tier lets an athlete author their week day by day. Levi's rule for
 * it: *"if the chosen design violates a program rule, the user should be
 * warned."* Warned — not silently overruled. So this module exists to give the
 * engine's rules a VOICE.
 *
 * ## Why this is the feature and not a chore
 *
 * Every rule below already exists as code and has for months —
 * `applySequencingGuards`, `separateLifts`, `spaceHardRunAfterLongRun`,
 * `capSessionsPerDay`, `runsForMileage`, `bandSessionCap`. What they have never
 * had is a way to say what they know. On a generated program they act silently,
 * because there is nobody to explain themselves to. On an authored one there is,
 * and an engine that can tell you *in your own week* why it would rather you
 * moved Thursday's intervals is the difference between a form and a coach.
 *
 * ## Three severities, and the difference matters
 *
 *   - **blocking** — the engine cannot produce a legal program from this. Three
 *     sessions on a day, fewer than three training days, a mileage week with no
 *     long run. These refuse.
 *   - **warning** — legal, and the athlete may proceed. This is where the
 *     research lives: back-to-back hard days, a hard run the day after the long
 *     run, too few runs for the mileage. The engine says what it would do
 *     differently and why, then does what it was asked.
 *   - **note** — informational. No quality session this week; fewer hybrids than
 *     the sport suggests.
 *
 * The split is deliberate and narrow. Almost nothing is blocking, because
 * blocking is the engine overruling the athlete, which is what Levi said not to
 * do. A rule is blocking only when honouring it is impossible, not when it is
 * inadvisable.
 *
 * PURE — no I/O, no dates, no database. Runs in the designer as the athlete
 * types AND server-side at submit, because a client-side-only validator is not a
 * validator.
 */

import type { ExperienceLevel, TemplateSession, TrainingDayName, WeekTemplate } from "./types";
import type { WeeklyHoursBand } from "@/lib/schemas";
import { MAX_SESSIONS_PER_DAY } from "./caps";
import { MIN_MILES_PER_RUN, runsForMileage } from "./slots";
import { bandSessionCap } from "./time-budget";

export type TemplateIssueSeverity = "blocking" | "warning" | "note";

export interface TemplateIssue {
  severity: TemplateIssueSeverity;
  /** Stable machine code, so the UI can link to an explanation. */
  code: string;
  message: string;
  /** The day this is about, when it is about one. */
  day?: TrainingDayName;
}

export interface TemplateContext {
  /** Days the athlete committed to training. Sessions on other days are dropped. */
  trainingDays: TrainingDayName[];
  /** Peak weekly mileage the program will build to, if known. */
  peakMileage?: number;
  /** The athlete's stated weekly hours budget, if known. */
  weeklyHours?: WeeklyHoursBand;
  runningExp?: ExperienceLevel;
  /** False for a station-only sport that prescribes no running (DEKA Strong). */
  prescribesRunning?: boolean;
  /** True when the sport has hybrid/station work to place (HYROX, DEKA). */
  prescribesHybrid?: boolean;
}

/** Minimum training days the engine will build a program from (`ProfileSchema`). */
const MIN_TRAINING_DAYS = 3;

const QUALITY_RUN_TYPES = new Set(["threshold", "tempo", "interval", "fartlek", "progression"]);

const DAY_ORDER: TrainingDayName[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABEL: Record<TrainingDayName, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

const isRun = (s: TemplateSession) => s.kind === "run";
const isLong = (s: TemplateSession) => s.kind === "run" && s.runType === "long";
const isQualityRun = (s: TemplateSession) =>
  s.kind === "run" && s.runType !== undefined && QUALITY_RUN_TYPES.has(s.runType);
/**
 * A session that leaves the athlete needing recovery before the next hard one.
 *
 * A BRICK counts, and it is worth saying why it counts here but NOT as a quality
 * session below. Both legs are Zone 2, so it adds no intensity to the week and
 * cannot stand in for the threshold or interval work a program needs — a week of
 * bricks and easy runs has no hard running in it at all, and `no_quality_run`
 * should still say so. But it is 55–70 minutes ending in a run on legs that have
 * already ridden, which is exactly the fatigue this rule is about. Same reasoning
 * that puts the long run here: hard is not the same question as fast.
 */
const isHard = (s: TemplateSession) =>
  isQualityRun(s) || isLong(s) || s.kind === "hybrid" || s.kind === "brick";
const isLegLift = (s: TemplateSession) =>
  s.kind === "lift" && (s.liftType === "lower" || s.liftType === "full");

/** Template days in calendar order, so "consecutive" means what it says. */
function orderedDays(t: WeekTemplate): { day: TrainingDayName; sessions: TemplateSession[] }[] {
  const byDay = new Map(t.days.map((d) => [d.day, d.sessions]));
  return DAY_ORDER.map((day) => ({ day, sessions: byDay.get(day) ?? [] }));
}

/**
 * Every issue an authored week raises, in severity order.
 *
 * Returns an empty array for a week the engine is happy to build as written —
 * which is the common case, and worth saying out loud in the UI rather than
 * leaving blank.
 */
export function validateTemplate(t: WeekTemplate, ctx: TemplateContext): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  const days = orderedDays(t);
  const active = days.filter((d) => d.sessions.length > 0);
  const all = days.flatMap((d) => d.sessions);
  const runs = all.filter(isRun);
  const prescribesRunning = ctx.prescribesRunning ?? true;

  // --- blocking -------------------------------------------------------------

  for (const d of days) {
    if (d.sessions.length > MAX_SESSIONS_PER_DAY) {
      issues.push({
        severity: "blocking",
        code: "too_many_sessions_in_a_day",
        day: d.day,
        message: `${DAY_LABEL[d.day]} has ${d.sessions.length} sessions. Two a day is the engine's hard ceiling — a third has nowhere legal to go, so the week could not be built as written.`,
      });
    }
  }

  if (active.length < MIN_TRAINING_DAYS) {
    issues.push({
      severity: "blocking",
      code: "too_few_training_days",
      message: `A program needs at least ${MIN_TRAINING_DAYS} training days; this week has ${active.length}. There is no way to distribute a week's work across fewer.`,
    });
  }

  const outsideCommitted = active.filter((d) => !ctx.trainingDays.includes(d.day));
  for (const d of outsideCommitted) {
    issues.push({
      severity: "blocking",
      code: "session_outside_training_days",
      day: d.day,
      message: `${DAY_LABEL[d.day]} holds work but is not one of your training days. Add it to your training days, or move the session.`,
    });
  }

  const longRuns = all.filter(isLong);
  if (prescribesRunning && runs.length > 0 && longRuns.length === 0) {
    issues.push({
      severity: "blocking",
      code: "no_long_run",
      message:
        "No long run. It is the week's anchor — the mileage target, the aerobic progression and the +10% jump ceiling are all measured against it, so a running week cannot be built without one.",
    });
  }

  if (longRuns.length > 1) {
    issues.push({
      severity: "blocking",
      code: "multiple_long_runs",
      message: `${longRuns.length} long runs. A week has one; the second would be sized as an easy run anyway, so name it as one.`,
    });
  }

  // --- warning --------------------------------------------------------------

  // Back-to-back hard days. `applySequencingGuards` and
  // `spaceHardRunAfterLongRun` enforce this silently on a generated week.
  for (let i = 0; i < DAY_ORDER.length - 1; i++) {
    const a = days[i]!; // safe: i < DAY_ORDER.length
    const b = days[i + 1]!; // safe: i + 1 < DAY_ORDER.length
    if (a.sessions.some(isHard) && b.sessions.some(isHard)) {
      issues.push({
        severity: "warning",
        code: "back_to_back_hard_days",
        day: b.day,
        message: `${DAY_LABEL[a.day]} and ${DAY_LABEL[b.day]} are both hard days. On a generated week the engine puts an easy day or a rest day between them — adaptation happens in the recovery, not in the session.`,
      });
    }
  }

  // A hard run the day after the long run, specifically. Worth its own message:
  // it is the single most common self-authored mistake and the reason
  // `spaceHardRunAfterLongRun` exists.
  for (let i = 0; i < DAY_ORDER.length - 1; i++) {
    const a = days[i]!; // safe: i < DAY_ORDER.length
    const b = days[i + 1]!; // safe: i + 1 < DAY_ORDER.length
    if (a.sessions.some(isLong) && b.sessions.some(isQualityRun)) {
      issues.push({
        severity: "warning",
        code: "quality_after_long_run",
        day: b.day,
        message: `A quality run the day after your long run. Those are the week's two biggest running stresses back to back, on legs that have not recovered from the first.`,
      });
    }
  }

  // Two lifts on consecutive days (`separateLiftDays`), and heavy legs the day
  // before a key run (`applySequencingGuards`).
  for (let i = 0; i < DAY_ORDER.length - 1; i++) {
    const a = days[i]!; // safe: i < DAY_ORDER.length
    const b = days[i + 1]!; // safe: i + 1 < DAY_ORDER.length
    if (a.sessions.some(isLegLift) && b.sessions.some(isLegLift)) {
      issues.push({
        severity: "warning",
        code: "consecutive_leg_lifts",
        day: b.day,
        message: `Heavy legs on ${DAY_LABEL[a.day]} and again on ${DAY_LABEL[b.day]}. The engine keeps full-body and lower-body lifts at least a day apart, and full-body lifts two where the week allows.`,
      });
    }
    if (a.sessions.some(isLegLift) && b.sessions.some((s) => isQualityRun(s) || isLong(s))) {
      issues.push({
        severity: "warning",
        code: "leg_lift_before_key_run",
        day: a.day,
        message: `A heavy leg session the day before ${DAY_LABEL[b.day]}'s key run. You will run it on tired legs and get less out of both.`,
      });
    }
  }

  for (const d of days) {
    if (d.sessions.filter((s) => s.kind === "lift").length > 1) {
      issues.push({
        severity: "warning",
        code: "two_lifts_one_day",
        day: d.day,
        message: `Two lifts on ${DAY_LABEL[d.day]}. One weight session a day is a standing rule — the second gets a fraction of the first's quality.`,
      });
    }
  }

  if (active.length === DAY_ORDER.length) {
    issues.push({
      severity: "warning",
      code: "no_rest_day",
      message:
        "No full rest day. The engine leaves at least one on every week it builds; training days are where you spend, rest days are where you bank it.",
    });
  }

  // THE VOLUME DOCTRINE, SURFACED. This is the rule Levi wrote himself, and it is
  // the one an athlete authoring their own week gets wrong most expensively —
  // they reach for longer runs because a week has only so many days, and length
  // is precisely the axis that carries the risk.
  if (prescribesRunning && ctx.peakMileage !== undefined && runs.length > 0) {
    // A HYBRID COUNTS. The doctrine is about how many times a week the athlete
    // covers distance on their feet, and a station session carries real running
    // legs between the stations — `hybridRunPlan` sizes them, and the reconciler
    // takes them out of the week's mileage budget like any other run. Counting
    // only `kind === "run"` made this fire on the engine's own presets: a
    // six-day week with a hybrid was told it needed a seventh run it had no room
    // for and did not actually need.
    const carriers = runs.length + all.filter((s) => s.kind === "hybrid").length;
    const want = runsForMileage(ctx.peakMileage);
    if (carriers < want) {
      const each = Math.round((ctx.peakMileage / carriers) * 10) / 10;
      issues.push({
        severity: "warning",
        code: "too_few_runs_for_mileage",
        message: `${carriers} sessions carrying a ${ctx.peakMileage}-mile peak week means about ${each} miles each. Doubling a single session's length roughly doubles injury risk, while adding sessions at a familiar length costs little or nothing — ${want} would carry the same mileage. The engine will build this as authored; it would rather you split it.`,
      });
    }
    // The other direction: more runs than the mileage can fill without dropping
    // below the floor a run stops being worth the trip at.
    const splittable = Math.floor(ctx.peakMileage / MIN_MILES_PER_RUN);
    if (carriers > splittable) {
      issues.push({
        severity: "warning",
        code: "too_many_runs_for_mileage",
        message: `${carriers} sessions across ${ctx.peakMileage} miles puts some of them under ${MIN_MILES_PER_RUN} miles. Below that a run costs a warm-up, a change of clothes and a trip, and takes training away from the runs it was split from — the engine will consolidate rather than ship one.`,
      });
    }
  }

  // The hours budget. `bandSessionCap` is what stops a week fragmenting into
  // token pieces on a generated program.
  if (ctx.weeklyHours) {
    const cap = bandSessionCap(ctx.weeklyHours);
    if (all.length > cap) {
      issues.push({
        severity: "warning",
        code: "over_session_budget",
        message: `${all.length} sessions against a budget of about ${cap} for the hours you selected. Either the week is bigger than the time you have, or the hours are understated.`,
      });
    }
  }

  const qualityRuns = runs.filter(isQualityRun);
  if (qualityRuns.length > 2) {
    issues.push({
      severity: "warning",
      code: "too_much_quality",
      message: `${qualityRuns.length} quality runs. Two hard running sessions a week is the ceiling most athletes adapt to; a third usually costs the quality of the other two.`,
    });
  }

  // --- note -----------------------------------------------------------------

  if (prescribesRunning && runs.length > 1 && qualityRuns.length === 0) {
    issues.push({
      severity: "note",
      code: "no_quality_run",
      message:
        "No quality run named. The engine will pick one appropriate to each phase — leave it that way and your hard day changes as the program moves base → build → peak, which is usually what you want.",
    });
  }

  if (ctx.prescribesHybrid && !all.some((s) => s.kind === "hybrid")) {
    issues.push({
      severity: "note",
      code: "no_hybrid",
      message:
        "No hybrid session. For a station sport that is the race itself — running fitness alone does not transfer to the stations.",
    });
  }

  if (!all.some((s) => s.kind === "lift")) {
    issues.push({
      severity: "note",
      code: "no_lifting",
      message:
        "No strength work. It is the cheapest injury insurance in the plan and the thing that carries the sled and the carries on race day.",
    });
  }

  return issues;
}

/** True when nothing here prevents the engine building the week as authored. */
export function templateIsBuildable(issues: TemplateIssue[]): boolean {
  return !issues.some((i) => i.severity === "blocking");
}
