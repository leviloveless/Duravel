import type { Metadata } from "next";
import Link from "next/link";
import TimeBudgetExplorer from "@/components/science/time-budget-explorer";

export const metadata: Metadata = {
  title: "The Science Behind Duravel — Training Volume, Intensity & Load",
  description:
    "How Duravel turns sport-science on training volume vs. intensity into your personalized plan: the same training load can come from very different weekly hours by adjusting intensity — with real tradeoffs. Read the methodology.",
};

function Finding({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-6">
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Finding {n}</div>
      <h3 className="mt-1 text-lg font-semibold tracking-tight text-zinc-900">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600">{children}</p>
    </div>
  );
}

export default function SciencePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-14">
      {/* Hero */}
      <div className="border-b border-zinc-200 pb-10">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">
          Methodology
        </div>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-zinc-900">
          The science behind your plan
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-zinc-600">
          Duravel isn&apos;t a template. Every program is built on the peer-reviewed science of
          training <em>load</em>, <em>volume</em>, and <em>intensity</em> — the same principles
          coaches use to decide how hard and how much you should train for your event and the time
          you actually have.
        </p>
        <div className="mt-6 flex flex-wrap gap-3 text-sm">
          <Link
            href="/science/volume-intensity"
            className="rounded-full bg-black px-5 py-2.5 font-medium text-white transition-colors hover:bg-zinc-800"
          >
            Read the full methodology
          </Link>
          <a
            href="/duravel-training-science.pdf"
            className="rounded-full border border-zinc-300 px-5 py-2.5 font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            Download the PDF
          </a>
        </div>
      </div>

      {/* The core idea */}
      <section className="py-10">
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Can ten hours a week match forty?
        </h2>
        <p className="mt-3 text-zinc-600">
          Partly — and knowing exactly where &quot;partly&quot; ends is what makes a plan work. You
          can hold a similar training <em>effect</em> across very different weekly hours by turning
          intensity up as volume comes down. But that trade only holds for some adaptations, and it
          gets more expensive the longer your event. Three findings from the research drive how
          Duravel programs you.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-1">
          <Finding n="1" title="Training load isn't one simple number">
            Every load metric weights hard work disproportionately — that&apos;s why a short, hard
            session can equal a long, easy one on paper. But two sessions with the same &quot;load&quot;
            can build different things. The <em>pattern</em> of training matters, not just the total.
          </Finding>
          <Finding n="2" title="Intensity replaces volume — for some things, not others">
            High intensity can preserve your VO₂max and aerobic power on a fraction of the hours. It
            cannot buy the adaptations that only accumulate with time: fat-burning efficiency,
            capillary and heart adaptations, tougher tendons, and <em>durability</em> — your
            resistance to fading late in a long race.
          </Finding>
          <Finding n="3" title="The tradeoff scales with your event and training age">
            For a short, punchy event (DEKA, a hard metcon), intensity is nearly a full substitute
            for volume. For a five-to-seventeen-hour Ironman, it isn&apos;t — those races are won on
            exactly the volume-built traits above. And the fitter you already are, the more the
            remaining gains live in volume.
          </Finding>
        </div>
      </section>

      {/* How Duravel uses it */}
      <section className="border-t border-zinc-200 py-10">
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-900">
          How Duravel uses this
        </h2>
        <ul className="mt-4 flex flex-col gap-3 text-zinc-600">
          <li className="flex gap-3">
            <span aria-hidden className="mt-1 text-zinc-400">
              →
            </span>
            <span>
              <strong className="font-semibold text-zinc-800">We ask how much time you have.</strong>{" "}
              Your weekly-hours budget sets your program&apos;s total volume — honestly, for the life
              you actually lead.
            </span>
          </li>
          <li className="flex gap-3">
            <span aria-hidden className="mt-1 text-zinc-400">
              →
            </span>
            <span>
              <strong className="font-semibold text-zinc-800">
                We scale your intensity mix to that volume.
              </strong>{" "}
              Fewer hours means a more concentrated, threshold-leaning week; more hours means a big
              easy base with hard work kept to what you can recover from — the polarized pattern
              elite endurance athletes actually use.
            </span>
          </li>
          <li className="flex gap-3">
            <span aria-hidden className="mt-1 text-zinc-400">
              →
            </span>
            <span>
              <strong className="font-semibold text-zinc-800">We protect what matters.</strong>{" "}
              When time is tight we keep your quality sessions and trim easy volume — the change the
              research says preserves fitness. We watch load progression and the strength/endurance
              balance so you build durability without breaking down.
            </span>
          </li>
          <li className="flex gap-3">
            <span aria-hidden className="mt-1 text-zinc-400">
              →
            </span>
            <span>
              <strong className="font-semibold text-zinc-800">We tell you the tradeoff.</strong>{" "}
              You&apos;ll always know what a given time budget buys you — and what it leaves on the
              table — so it&apos;s an informed choice, not an invisible one.
            </span>
          </li>
        </ul>
      </section>

      {/* Interactive explorer */}
      <section className="border-t border-zinc-200 py-10">
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-900">
          See it for your sport
        </h2>
        <p className="mt-3 text-zinc-600">
          Pick a sport and a weekly-time budget to see where it puts you — and how the intensity mix
          shifts.
        </p>
        <div className="mt-5">
          <TimeBudgetExplorer />
        </div>
      </section>

      {/* Honesty / evidence */}
      <section className="border-t border-zinc-200 py-10">
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Where the evidence is strong — and where it isn&apos;t
        </h2>
        <p className="mt-3 text-zinc-600">
          We hold ourselves to the evidence. The core principles here rest on decades of endurance
          and exercise-physiology research across many independent studies. Some areas are newer:
          HYROX has only begun to be studied in the lab, and DEKA hasn&apos;t been formally studied
          yet — so for those we lean on transferable physiology and coaching experience, and we say
          so. The full methodology lists the studies and flags exactly what is settled versus still
          emerging.
        </p>
        <div className="mt-6 flex flex-wrap gap-3 text-sm">
          <Link
            href="/science/volume-intensity"
            className="rounded-full bg-black px-5 py-2.5 font-medium text-white transition-colors hover:bg-zinc-800"
          >
            Read the full methodology
          </Link>
          <Link
            href="/onboarding"
            className="rounded-full border border-zinc-300 px-5 py-2.5 font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            Build your program
          </Link>
        </div>
      </section>
    </main>
  );
}
