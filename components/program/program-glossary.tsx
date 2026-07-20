/**
 * "Understanding your program" (#9) — a plain-language reference that demystifies
 * every concept the program view shows: phases, microcycles, HR zones, each
 * session type, the strength scheme (emphasis, %1RM · RIR, plyometrics, A/B
 * exercise rotation), and the tracking loop (RPE, readiness, adaptation, wearable
 * sync). Static + accessible: native <details>/<summary> accordions, no client JS.
 *
 * Content is grounded in the real engine (lib/engine/*) so the explanations match
 * what the athlete actually sees.
 */

function Term({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="group border-b border-zinc-200 last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3 text-sm font-medium text-zinc-800 marker:content-none">
        <span>{q}</span>
        <span aria-hidden className="text-zinc-400 transition-transform group-open:rotate-45">
          +
        </span>
      </summary>
      <div className="pb-3 text-sm leading-relaxed text-zinc-600">{children}</div>
    </details>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-200 p-4">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
      <div>{children}</div>
    </div>
  );
}

export default function ProgramGlossary() {
  return (
    <section aria-labelledby="glossary-title" className="print:hidden">
      <details className="group rounded-2xl border border-zinc-200 bg-white">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 marker:content-none">
          <div>
            <h2 id="glossary-title" className="text-sm font-semibold">
              Understanding your program
            </h2>
            <p className="text-xs text-zinc-500">
              What the phases, zones, sessions, and numbers actually mean.
            </p>
          </div>
          <span
            aria-hidden
            className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-500 transition-transform group-open:rotate-45"
          >
            +
          </span>
        </summary>

        <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
          <Group title="How the plan is structured">
            <Term q="Phases (Base → Build → Peak → Taper)">
              Your program moves through training phases. <strong>Base</strong> builds your aerobic
              engine and general strength; <strong>Build</strong> adds race-specific intensity;{" "}
              <strong>Peak</strong> sharpens you at race demands; <strong>Taper</strong> cuts volume
              so you arrive fresh. Each phase changes what your sessions emphasize.
            </Term>
            <Term q="Microcycle weeks (rebound / increase / deload)">
              Within a phase, weeks rotate so you progress without burning out.{" "}
              <strong>Increase</strong> weeks add load; <strong>deload</strong> weeks back off to let
              you absorb the work and adapt; <strong>rebound</strong> weeks re-establish load after a
              deload. This rise-and-recover rhythm is how fitness actually builds.
            </Term>
            <Term q="Race weeks (A / B / C)">
              An <strong>A race</strong> is your main goal — the plan peaks and tapers for it. A{" "}
              <strong>B race</strong> gets a small taper; a <strong>C race</strong> is trained
              through (no taper) as a hard workout or tune-up.
            </Term>
          </Group>

          <Group title="Heart-rate zones">
            <Term q="What the zones mean">
              Zones are intensity bands set from your max heart rate (or your tested/threshold HR if
              you entered it). <strong>Zone 1–2</strong> = easy aerobic (most of your volume, builds
              the engine); <strong>Zone 3</strong> = steady/tempo; <strong>Zone 4</strong> =
              threshold (comfortably hard); <strong>Zone 5</strong> = VO₂max / very hard, short
              intervals. Training the right zones — not just going hard — is what drives adaptation.
            </Term>
            <Term q="Why so much easy work?">
              Most endurance gains come from a large base of easy Zone 1–2 work with smaller doses of
              hard work. Going too hard on easy days blunts recovery and the hard days that matter.
            </Term>
          </Group>

          <Group title="Your sessions">
            <Term q="Runs (easy, tempo, threshold, intervals, long, fartlek)">
              Each run type trains something specific: <strong>easy</strong> aerobic base,{" "}
              <strong>tempo/threshold</strong> your sustainable race pace, <strong>intervals</strong>{" "}
              top-end speed and VO₂max, <strong>long</strong> runs endurance, <strong>fartlek</strong>{" "}
              playful speed changes. Paces are set from your benchmarks.
            </Term>
            <Term q="Lift sessions (upper / lower / full)">
              Strength work, periodized to the phase. The full-body day is heavy/low-rep for max
              strength (which improves running economy without adding bulk); upper/lower days are
              moderate strength; the lunge pattern stays high-rep muscular endurance.
            </Term>
            <Term q="Hybrid / HYROX sessions">
              Race-specific station work (sled, carries, wall balls, erg, etc.) at your division
              loads, mixed with running — training the actual demands of the event.
            </Term>
            <Term q="Zone 1–2 cardio">
              Non-running easy aerobic work (bike, row, ski) added to hit your weekly aerobic minutes
              without piling on running impact.
            </Term>
            <Term q="Swim / bike / brick (triathlon)">
              Discipline-specific sessions plus <strong>bricks</strong> — a bike immediately followed
              by a run — so your legs learn the race-day transition.
            </Term>
          </Group>

          <Group title="Strength details">
            <Term q="“~85% 1RM · 2 RIR” — what is that?">
              Your target working load. <strong>%1RM</strong> is a percentage of your one-rep max (we
              estimate it from the 5-rep maxes you entered). <strong>RIR</strong> = reps in reserve —
              how many more reps you could do; “2 RIR” means stop with about two left in the tank.
              This autoregulates load to how you feel that day.
            </Term>
            <Term q="A / B exercise variation">
              Each lift pattern alternates between two exercises week to week (e.g. Back Squat one
              week, Front Squat the next). Same training effect, less repetitive stress — it reduces
              overuse from grinding the identical movement every session.
            </Term>
            <Term q="Plyometrics">
              Explosive jumps in Base/Build phases. Done with full recovery and hard intent (not to
              fatigue), they build rate-of-force-development and running economy.
            </Term>
          </Group>

          <Group title="Tracking & adaptation">
            <Term q="RPE (rate of perceived exertion)">
              A 1–10 rating of how hard a session felt (1 = very easy, 10 = maximal). Logging RPE
              lets the plan see your true training strain and adjust — it’s the simplest, most
              reliable load signal.
            </Term>
            <Term q="Readiness check-in">
              A quick weekly rating of sleep, fatigue, stress, and soreness (plus resting HR / HRV if
              you have them). Low readiness lets the plan soften the coming week <em>before</em> a bad
              stretch instead of only reacting after.
            </Term>
            <Term q="Resting HR & HRV">
              Morning recovery signals. A resting HR that’s trending up or an HRV trending down versus
              your own baseline is an early sign you need more recovery. If you connect a wearable,
              these prefill automatically.
            </Term>
            <Term q="Weekly review & recalculation">
              After a week is fully logged (or has elapsed), the plan reviews your completion, effort,
              and load and adapts the next week — easing off if you’re overreaching, pushing on if
              you’re thriving. Reviewed weeks are locked so the adjustment has a stable audit trail.
            </Term>
          </Group>

          <Group title="Wearables & sync">
            <Term q="Connecting a wearable">
              Connect Strava or Oura in Settings → Connections. Synced activities import
              automatically and can be linked to a planned session — carrying over your distance,
              duration, heart rate, and (from Strava) your RPE and notes, so logging is nearly
              automatic.
            </Term>
            <Term q="One session from multiple sources">
              If the same workout arrives from more than one source, the plan detects the duplicate
              and keeps a single canonical record, so nothing is double-counted.
            </Term>
          </Group>
        </div>
      </details>
    </section>
  );
}
