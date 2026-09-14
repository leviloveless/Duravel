import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getCurrentProfile,
  getProgramAdaptations,
  getProgramExtras,
  getProgramLogs,
  getUserEvents,
  getUserPrograms,
  type ProgramSummaryRow,
} from "@/lib/supabase/queries";
import { getUserActivities } from "@/lib/wearables/activities";
import { formatInstant } from "@/lib/timezone";
import { signOut } from "@/app/login/actions";
import { extrasFromRows } from "@/lib/extra-workouts";
import { adherenceStreak } from "@/lib/engine/adapt";
import { weekStartDate } from "@/components/program/format";
import type { ProgramData, WorkoutLog } from "@/lib/schemas";
import {
  asHours,
  countdown,
  goalSeconds,
  stationBands,
  weeklyHours,
  zoneMix,
} from "@/lib/dashboard/derive";
import {
  FitnessChart,
  HoursChart,
  StationBandChart,
  ZoneChart,
} from "@/components/dashboard/charts";
import WeekStrip from "@/components/dashboard/week-strip";
import SetupNudge from "@/components/dashboard/setup-nudge";
import { EngineChangesCard, RecentActivityCard } from "@/components/dashboard/activity-cards";
import EventsCard from "@/components/dashboard/events-card";
import { countdownTo, eventTitle, nextRace } from "@/lib/events/derive";
import {
  dailyLoad,
  fitnessSeries,
  formState,
  FORM_BLURB,
  FORM_LABEL,
} from "@/lib/dashboard/fitness";
import TrialBanner from "@/components/trial-banner";
import Walkthrough from "@/components/onboarding/walkthrough";
import RenameProgram from "./rename-program";
import DeleteProgram from "./delete-program";

const TYPE_LABEL: Record<string, string> = {
  goal_event: "Goal event",
  fixed_duration: "Fixed duration",
  general_fitness: "General fitness",
};

const STATUS_STYLE: Record<ProgramSummaryRow["status"], string> = {
  ready: "bg-emerald-100 text-emerald-800",
  generating: "bg-amber-100 text-amber-800",
  failed: "bg-red-100 text-red-800",
};

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * The current time, read once per request.
 *
 * Wrapped rather than called inline because `react-hooks/purity` rightly objects
 * to `Date.now()` in a component body — an impure call in render is unstable
 * across re-renders. This is a SERVER component, rendered once per request, so
 * "what time is it" is genuinely part of the request and there is no hook to
 * hang it on. Reading it exactly once here also means the countdown, the current
 * week and today's column can never disagree by a tick.
 */
function requestNow(): { ms: number; dayIndex: number } {
  const d = new Date();
  return { ms: d.getTime(), dayIndex: d.getDay() };
}
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** `created_at` is an INSTANT — pin the zone or server and client disagree near midnight. */
function formatDate(iso: string, tz: string | null): string {
  return formatInstant(iso, tz, { month: "short", day: "numeric", year: "numeric" }, "");
}

function programTitle(p: ProgramSummaryRow): string {
  return (
    p.name ?? `${p.duration_weeks}-week ${TYPE_LABEL[p.program_type] ?? p.program_type} program`
  );
}

function Tile({
  label,
  value,
  unit,
  foot,
}: {
  label: string;
  value: string;
  unit?: string;
  foot: React.ReactNode;
}) {
  return (
    <div className="border-line flex flex-col gap-1.5 rounded-xl border bg-white p-4">
      <span className="font-mono text-[10px] tracking-[0.14em] text-zinc-500 uppercase">
        {label}
      </span>
      <span className="font-mono text-2xl leading-none font-semibold tracking-tight">
        {value}
        {unit && <span className="text-sm text-zinc-500">{unit}</span>}
      </span>
      <span className="text-[11px] text-zinc-500">{foot}</span>
    </div>
  );
}

function Card({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-line flex flex-col rounded-xl border bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {meta && <span className="font-mono text-[11px] text-zinc-500">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [profile, programs, events] = await Promise.all([
    getCurrentProfile(),
    getUserPrograms(),
    getUserEvents(),
  ]);

  // Today as a LOCAL calendar date. A race countdown is a date difference, not
  // an instant — see the note in lib/signup-checks.ts.
  const nowDate = new Date();
  const todayISO = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, "0")}-${String(nowDate.getDate()).padStart(2, "0")}`;

  // The active program: most recent ready one that has started and not finished.
  // Same rule the "This week" card used, kept here so the dashboard has one
  // answer to "which program am I looking at" rather than two.
  const { data: candidates } = await supabase
    .from("programs")
    .select("id, name, duration_weeks, start_date, program_data")
    .eq("user_id", user.id)
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(5);

  const { ms: now, dayIndex } = requestNow();
  const active = (candidates ?? []).find((p) => {
    const start = weekStartDate(p.start_date, 1).getTime();
    return now >= start && now < start + p.duration_weeks * MS_PER_WEEK && p.program_data;
  });

  let body: React.ReactNode = null;

  if (active) {
    const data = active.program_data as ProgramData;
    const start = weekStartDate(active.start_date, 1).getTime();
    const elapsed = Math.max(0, Math.floor((now - start) / MS_PER_WEEK));
    const currentWeek = Math.min(active.duration_weeks, elapsed + 1);
    const week = data.weeks.find((w) => w.weekNumber === currentWeek) ?? data.weeks[0];

    const [logRows, extraRows, adaptations, activities] = await Promise.all([
      getProgramLogs(active.id),
      getProgramExtras(active.id),
      getProgramAdaptations(active.id).catch(() => []),
      getUserActivities(30).catch(() => []),
    ]);
    const logs: WorkoutLog[] = logRows.map((r) => ({
      weekNumber: r.week_number,
      day: r.day,
      sessionIndex: r.session_index,
      status: r.status,
      rpe: r.rpe,
      actuals: r.actuals,
      note: r.note,
    }));
    const extras = extrasFromRows(extraRows);

    const hours = weeklyHours(data.weeks, logs, extras, elapsed);
    const thisWeek = hours.find((h) => h.weekNumber === currentWeek);
    const zones = zoneMix(data.weeks);
    const streak = elapsed >= 1 ? adherenceStreak(data.weeks, logs, elapsed, extras) : 0;

    const bands = stationBands(profile?.benchmarks ?? null, {
      sex: profile?.sex ?? undefined,
      division: profile?.division ?? undefined,
      age: profile?.age ?? undefined,
      goalFinishSeconds: goalSeconds(profile?.goal_finish_time),
    });
    const weakest = [...bands].sort((a, b) => a.position - b.position)[0];

    // Fitness / fatigue / form over the block so far. `weekStartDate` is the same
    // helper the program page uses, so a day here is the same day there.
    const toISO = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const weekStartISO = (n: number) => toISO(weekStartDate(active.start_date, n));
    const load = dailyLoad(data.weeks, logs, extras, weekStartISO);
    const series = fitnessSeries(load, weekStartISO(1), toISO(new Date(now)));
    const todayPoint = series[series.length - 1];
    const state = todayPoint ? formState(todayPoint) : null;

    // The countdown comes from the athlete's EVENTS first and falls back to the
    // block's own race week. Events are season-level and can name the race;
    // `raceDay` only knows there is one. When both exist the events card is what
    // surfaces any disagreement between them — see `dateDrift`.
    const fromEvents = nextRace(events, todayISO);
    const aRace = data.weeks.find((w) => w.raceDay?.priority === "A" && w.raceDay.date);
    const race = fromEvents
      ? countdownTo(fromEvents)
      : aRace?.raceDay?.date
        ? countdown(aRace.raceDay.date)
        : null;
    const raceName = fromEvents ? eventTitle(fromEvents) : null;

    const z3 = zones.find((z) => z.zone === 3);
    const greyZoneDrift = z3 ? z3.actual - z3.target : 0;
    const todayKey = DAY_KEYS[dayIndex] ?? "mon";

    body = (
      <>
        <section className="bg-brand grid grid-cols-1 overflow-hidden rounded-xl text-zinc-200 lg:grid-cols-[1.15fr_1fr]">
          <div className="flex flex-col gap-3 px-5 py-5">
            <span className="text-accent-hi font-mono text-[10px] tracking-[0.14em] uppercase">
              {race ? "A race · goal event" : "Current block"}
            </span>
            {race ? (
              <div className="flex items-end gap-3">
                <span className="font-display text-5xl leading-none font-bold text-white">
                  {race.days}
                </span>
                <span className="pb-1 text-xs text-zinc-400">
                  {raceName ? `days to ${raceName}` : "days to race"}
                  <br />
                  <b className="font-semibold text-white">
                    {race.weeks} weeks {race.spareDays} days
                  </b>
                </span>
              </div>
            ) : (
              <div className="flex items-end gap-3">
                <span className="font-display text-5xl leading-none font-bold text-white">
                  {currentWeek}
                </span>
                <span className="pb-1 text-xs text-zinc-400">
                  of {active.duration_weeks}
                  <br />
                  <b className="font-semibold text-white">weeks</b>
                </span>
              </div>
            )}
            <div className="tick-tape tick-tape-invert mt-auto" aria-hidden="true" />
            <div className="flex flex-wrap gap-4 text-[11px] text-zinc-400">
              <span>
                Week{" "}
                <b className="text-white">
                  {currentWeek} of {active.duration_weeks}
                </b>
              </span>
              {week && (
                <span>
                  Phase <b className="text-white">{week.phase}</b>
                </span>
              )}
              {profile?.division && (
                <span>
                  Division <b className="text-white">{profile.division}</b>
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2 bg-white p-5 text-zinc-900">
            <span className="font-mono text-[10px] tracking-[0.14em] text-zinc-500 uppercase">
              {active.name ?? "Your program"}
            </span>
            <p className="text-sm text-zinc-600">
              {thisWeek
                ? `This week asks for ${asHours(thisWeek.plannedMin)} hours across ${week?.days.filter((d) => d.sessions.length).length ?? 0} training days.`
                : "This week's plan is ready."}
            </p>
            <div className="mt-auto flex flex-wrap gap-2 pt-2">
              <Link
                href={`/program/${active.id}`}
                className="border-line-strong rounded-md border px-4 py-2 text-sm font-semibold hover:bg-zinc-50"
              >
                Open week {currentWeek}
              </Link>
              <Link
                href="/library"
                className="text-accent px-2 py-2 text-sm font-semibold underline"
              >
                Workout library
              </Link>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            label="This week"
            value={String(asHours(thisWeek?.completedMin ?? 0))}
            unit={` / ${asHours(thisWeek?.plannedMin ?? 0)} h`}
            foot={
              thisWeek && thisWeek.plannedMin > 0
                ? `${Math.round(((thisWeek.completedMin ?? 0) / thisWeek.plannedMin) * 100)}% of the plan so far`
                : "Nothing scheduled"
            }
          />
          <Tile
            label="Adherence"
            value={String(streak)}
            unit={streak === 1 ? " week" : " weeks"}
            foot="Consecutive weeks at 80% or better"
          />
          <Tile
            label="Form"
            value={todayPoint ? String(todayPoint.form) : "—"}
            foot={state ? FORM_LABEL[state] : "Log a few sessions to see this"}
          />
          <Tile
            label="Weakest station"
            value={weakest ? `${Math.round(weakest.position * 100)}` : "—"}
            unit={weakest ? "%" : undefined}
            foot={
              weakest
                ? `${weakest.label} — of its reference band`
                : "Add a HYROX result to see this"
            }
          />
        </div>

        <Card title={`This week · week ${currentWeek} of ${active.duration_weeks}`}>
          {week ? (
            <WeekStrip week={week} logs={logs} todayKey={todayKey} programId={active.id} />
          ) : (
            <p className="text-sm text-zinc-500">No sessions this week.</p>
          )}
        </Card>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.3fr_1fr]">
          <Card title="Planned vs completed hours" meta={`${data.weeks.length} weeks`}>
            <HoursChart weeks={hours} />
          </Card>

          <Card title="Intensity distribution" meta="Whole program">
            <ZoneChart slices={zones} />
            {greyZoneDrift > 3 && (
              <p className="bg-accent-wash mt-3 rounded-lg px-3 py-2.5 text-[13px] leading-relaxed text-zinc-700">
                Zone 3 is <b>{greyZoneDrift} points over</b> target. That is grey-zone drift: too
                hard to build the aerobic base, too easy to move threshold. Your easy runs are the
                ones to slow down.
              </p>
            )}
          </Card>
        </div>

        {todayPoint && series.length > 7 && (
          <Card title="Fitness, fatigue and form" meta={`${series.length} days`}>
            <FitnessChart points={series} />
            {state && (
              <p className="bg-accent-wash mt-3 rounded-lg px-3 py-2.5 text-[13px] leading-relaxed text-zinc-700">
                <b>{FORM_LABEL[state]}.</b> {FORM_BLURB[state]}
              </p>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
              Duravel&rsquo;s own load units, not TSS — a sled push has no threshold pace to score
              against. The shape is what to read, not the absolute number.
            </p>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Card title="Races" meta={`${events.length} on the calendar`}>
            <EventsCard
              events={events}
              today={todayISO}
              programDateFor={(programId) =>
                programId === active.id ? (aRace?.raceDay?.date ?? null) : null
              }
            />
          </Card>
          <Card title="What the engine changed" meta="Most recent first">
            <EngineChangesCard adaptations={adaptations} />
          </Card>
          <Card title="Recent activity">
            <RecentActivityCard activities={activities} />
          </Card>
        </div>

        {bands.length > 0 && (
          <Card
            title="Station benchmarks vs the field"
            meta={[profile?.sex, profile?.division, profile?.age ? `age ${profile.age}` : null]
              .filter(Boolean)
              .join(" · ")}
          >
            <StationBandChart rows={bands} />
            <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
              Each bar spans the public reference band for your sex, division and age — the same
              table the projection model uses. The diamond is your goal split.
            </p>
          </Card>
        )}
      </>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold tracking-wide uppercase">
          {profile?.first_name ? `Welcome back, ${profile.first_name}` : "Your dashboard"}
        </h1>
        <div className="flex items-center gap-4">
          <Walkthrough autoStart={programs.length === 0} />
          <form action={signOut}>
            <button type="submit" className="text-sm text-zinc-500 underline">
              Sign out
            </button>
          </form>
        </div>
      </div>

      {!profile?.setup_completed_at && (
        <SetupNudge
          hasBenchmarks={!!profile?.benchmarks && Object.keys(profile.benchmarks).length > 0}
          hasRestingHr={profile?.resting_hr != null}
          hasBodyWeight={profile?.body_weight != null}
        />
      )}

      <TrialBanner />
      {body}

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <Link
          href="/onboarding"
          className="bg-accent hover:bg-accent-hi rounded-md px-5 py-2.5 text-sm font-semibold text-white"
        >
          {programs.length > 0 ? "Build a new program" : "Build your program"}
        </Link>
        <Link href="/calendar" className="text-sm text-zinc-600 underline">
          Calendar
        </Link>
        <Link href="/library" className="text-sm text-zinc-600 underline">
          Workout library
        </Link>
        <Link href="/diagnostic" className="text-sm text-zinc-600 underline">
          Find my limiter
        </Link>
        <Link href="/tools/hyrox-lookup" className="text-sm text-zinc-600 underline">
          Find my HYROX result
        </Link>
      </div>

      {programs.length === 0 ? (
        <p className="text-zinc-600">You haven&apos;t generated any programs yet.</p>
      ) : (
        <Card title="Your programs">
          <ul className="flex flex-col gap-2">
            {programs.map((p) => (
              <li
                key={p.id}
                className="border-line flex items-center gap-2 rounded-lg border pr-3 transition-colors hover:bg-zinc-50"
              >
                <Link
                  href={`/program/${p.id}`}
                  className="flex flex-1 items-center justify-between gap-3 px-4 py-3"
                >
                  <span className="flex flex-col">
                    <span className="font-medium">{programTitle(p)}</span>
                    <span className="text-xs text-zinc-500">
                      {p.duration_weeks} weeks · {TYPE_LABEL[p.program_type] ?? p.program_type} ·
                      created {formatDate(p.created_at, profile?.timezone ?? null)}
                    </span>
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[p.status]}`}
                  >
                    {p.status === "ready"
                      ? "Ready"
                      : p.status === "generating"
                        ? "Generating…"
                        : "Failed"}
                  </span>
                </Link>
                <RenameProgram programId={p.id} currentName={programTitle(p)} />
                <DeleteProgram programId={p.id} title={programTitle(p)} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {profile && (
        <Link href="/profile" className="self-start text-sm underline">
          Edit profile
        </Link>
      )}
    </main>
  );
}
