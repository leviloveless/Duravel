import type { Metadata } from "next";
import Link from "next/link";
import TimeBudgetExplorer from "@/components/science/time-budget-explorer";

export const metadata: Metadata = {
  title: "Training Volume vs. Intensity — The Duravel Methodology",
  description:
    "A plain-English review of the science behind Duravel: how training load works, when intensity can replace volume and when it can't, what accumulated volume uniquely builds, and how the right balance changes for HYROX, DEKA, and triathlon.",
};

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-12 scroll-mt-20 text-2xl font-semibold tracking-tight text-zinc-900">
      {children}
    </h2>
  );
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 leading-relaxed text-zinc-700">{children}</p>;
}
function Lead({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 text-lg leading-relaxed text-zinc-600">{children}</p>;
}

const SECTIONS = [
  ["load", "1 · What training load actually is"],
  ["substitution", "2 · When intensity can replace volume"],
  ["volume", "3 · What only volume can build"],
  ["distribution", "4 · Easy, hard, and the mix in between"],
  ["sports", "5 · Why your event changes the answer"],
  ["budgets", "6 · What each time budget buys"],
  ["evidence", "7 · Evidence & honest limits"],
  ["references", "References"],
] as const;

export default function VolumeIntensityPaper() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-14">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">
        Duravel Methodology
      </div>
      <h1 className="mt-3 text-4xl font-bold tracking-tight text-zinc-900">
        Training volume vs. intensity
      </h1>
      <Lead>
        How athletes get the same training effect from very different weekly hours by adjusting
        intensity — what that trade costs, and how the balance changes for HYROX, DEKA, and
        triathlon. This is the plain-English version of the research Duravel&apos;s programs are
        built on.
      </Lead>

      {/* TOC */}
      <nav className="mt-8 rounded-2xl border border-zinc-200 bg-zinc-50 p-5">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Contents</div>
        <ol className="mt-2 flex flex-col gap-1 text-sm">
          {SECTIONS.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="text-zinc-600 hover:text-black hover:underline">
                {label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <H2 id="load">1 · What training load actually is</H2>
      <P>
        Coaches quantify a workout as roughly <em>intensity × duration</em>. Every serious method —
        heart-rate &quot;training impulse,&quot; session-effort scores, cycling&apos;s Training
        Stress Score — does this, and each one deliberately counts hard minutes for much more than
        easy minutes. That math is why a short, brutal session can register the same
        &quot;load&quot; as a long, gentle one.
      </P>
      <P>
        The catch: that single number is a convenience, not the whole truth. Two workouts with an
        identical load score can drive different adaptations, because your body responds to the
        specific pattern of stress, not just its total. So load is a useful budget — Duravel tracks
        it, and the way it accumulates and recovers — but it is never the only thing that matters.
      </P>

      <H2 id="substitution">2 · When intensity can replace volume</H2>
      <P>
        The case for training hard on little time is real. In controlled studies, athletes cut up to
        ~90% of their training volume and — by performing the remaining sliver at near-maximal
        intensity — held onto most of their gains in VO₂max (the ceiling on aerobic power) and in
        the muscle&apos;s energy machinery. One well-known study reproduced the aerobic gain of a
        45-minute moderate session with about a single minute of genuinely hard work per session.
      </P>
      <P>
        For a time-crunched athlete chasing aerobic power or general fitness, this is a legitimate,
        efficient substitution. It is the engine behind every &quot;you only need 20 minutes&quot;
        program — and, used honestly, it works.
      </P>

      <H2 id="volume">3 · What only volume can build</H2>
      <P>
        Here is what those short-and-hard studies usually don&apos;t measure — and where the trade
        stops being free. A set of performance-deciding adaptations respond to accumulated time, not
        to intensity, and they fade if the volume goes away:
      </P>
      <ul className="mt-4 flex flex-col gap-2 text-zinc-700">
        {[
          ["Capillaries and blood volume", "the plumbing that delivers oxygen and clears fatigue — grown by sustained easy work, not brief hard efforts."],
          ["Fat-burning efficiency", "the ability to spare precious carbohydrate — decisive in anything over ~90 minutes, built by hours."],
          ["A bigger, stronger heart", "stroke-volume and cardiac remodeling develop over months of endurance training."],
          ["Tougher connective tissue", "tendons and bone adapt far more slowly than muscle; rushing intensity outruns them and invites injury."],
          ["Durability", "your resistance to fading late in a long event — arguably the trait that decides long races, and one built almost entirely by accumulated volume."],
        ].map(([t, d]) => (
          <li key={t} className="flex gap-3">
            <span aria-hidden className="mt-1 text-zinc-400">
              →
            </span>
            <span>
              <strong className="font-semibold text-zinc-800">{t}</strong> — {d}
            </span>
          </li>
        ))}
      </ul>
      <P>
        There&apos;s also a training-age effect: most of the dramatic &quot;low-volume works just as
        well&quot; findings come from beginners over short studies. The fitter you already are, the
        more your remaining progress lives in the slow, volume-built traits above — which is exactly
        why the best endurance athletes in the world train many easy hours, not just a few hard ones.
      </P>

      <H2 id="distribution">4 · Easy, hard, and the mix in between</H2>
      <P>
        How you spread intensity matters as much as how much you do. Elite endurance athletes
        converge on a &quot;polarized&quot; pattern — roughly four-fifths genuinely easy, a
        meaningful slice genuinely hard, and very little in the vague middle. The reason is simple:
        the amount of hard work you can absorb and recover from is limited and doesn&apos;t grow much
        with total hours. So as volume rises, that fixed dose of hard work becomes a smaller share,
        and the week naturally becomes more polarized.
      </P>
      <P>
        The flip side: when you only have a few hours, you can&apos;t fill them with easy miles and
        still get a stimulus, so the mix sensibly shifts toward more threshold and hard work. That
        is why Duravel doesn&apos;t use a fixed intensity recipe — it scales the mix to your volume,
        from threshold-leaning at a few hours to strongly polarized at many. And when your available
        time suddenly drops, the research is clear about the priority: keep the hard quality, trim
        the easy volume. That&apos;s the change that preserves fitness.
      </P>

      <H2 id="sports">5 · Why your event changes the answer</H2>
      <P>
        The single biggest factor in how the volume-vs-intensity trade resolves is how long your
        event lasts.
      </P>
      <P>
        <strong className="font-semibold text-zinc-800">HYROX</strong> (~50–90 minutes) is
        aerobic-dominant with a strength floor. It rewards a big engine and race-specific
        &quot;compromised running&quot; — running well while fatigued — which is a durability trait.
        Heavy and explosive strength earns its place not for raw power but because it blunts how much
        you slow down late in the race.
      </P>
      <P>
        <strong className="font-semibold text-zinc-800">DEKA</strong> spans a wide range: STRONG
        (~10–14 min, no running) is a near-maximal strength-endurance sprint where intensity is
        almost a full substitute for volume; FIT (~30 min) sits closer to HYROX. Short events
        forgive low volume; long ones don&apos;t.
      </P>
      <P>
        <strong className="font-semibold text-zinc-800">Triathlon and Ironman</strong> are where
        volume matters most. A 70.3 or a full Ironman is decided by fat-burning efficiency, fueling
        tolerance, and durability over many hours — all volume-built. Low-hour plans can get you to
        the finish line; they can&apos;t reliably get you <em>competing</em> through the back half,
        where the race is actually won. Olympic-distance triathlon, being shorter, rewards intensity
        and economy more, and needs fewer raw hours.
      </P>

      <H2 id="budgets">6 · What each time budget buys</H2>
      <P>
        This is the honest part most programs skip. Every weekly-hours budget is a real choice with
        real tradeoffs — and those tradeoffs are different for each sport. Explore them here:
      </P>
      <div className="mt-5">
        <TimeBudgetExplorer />
      </div>
      <P>
        Duravel builds this directly into your plan: you tell us the hours you have, and we set your
        volume, scale your intensity mix to match, and tell you plainly what that budget gives you
        and what it leaves on the table.
      </P>

      <H2 id="evidence">7 · Evidence &amp; honest limits</H2>
      <P>
        The core of this — how load works, the specific adaptations volume builds, and the way the
        trade scales with event length — rests on decades of exercise-physiology research across
        many independent studies. We hold to a few honesty rules:
      </P>
      <ul className="mt-4 flex flex-col gap-2 text-zinc-700">
        {[
          "HYROX has only recently been studied in the lab (small early studies), so some of its specifics are reasoned from transferable physiology.",
          "DEKA hasn't been formally studied yet — its profiles are informed inferences from its format and duration, not measured facts.",
          "The advantage of any one intensity pattern over another is real but modest; total volume and consistency matter more.",
          "Individual response varies. Your plan adapts to your benchmarks and how you actually respond, not to a population average.",
        ].map((t) => (
          <li key={t} className="flex gap-3">
            <span aria-hidden className="mt-1 text-zinc-400">
              •
            </span>
            <span>{t}</span>
          </li>
        ))}
      </ul>
      <P>
        None of these caveats change the shape of the guidance — they just keep us calibrated. Good
        training is a well-managed set of tradeoffs, and being honest about them is the whole point.
      </P>

      <H2 id="references">References</H2>
      <p className="mt-4 text-sm leading-relaxed text-zinc-500">
        Selected sources informing this methodology: Seiler (2010), <em>IJSPP</em> — training
        intensity distribution. Stöggl &amp; Sperlich (2014), <em>Frontiers in Physiology</em> —
        polarized vs. other models. Gibala et al. (2006) and Burgomaster et al. (2005, 2008),{" "}
        <em>J. Physiol / J. Appl. Physiol</em> — low-volume interval training. Gillen &amp; Gibala
        (2016), <em>PLoS ONE</em> — one-minute intense work vs. moderate training. MacInnis et al.
        (2017), <em>J. Physiol</em> — intensity vs. volume at matched work. Mølmen et al. (2025),{" "}
        <em>Sports Medicine</em> — volume vs. intensity meta-analysis. Hickson et al. (1981–1985) —
        reduced-training studies. Bosquet et al. (2007), <em>MSSE</em> — tapering. Maunder et al.
        (2021), <em>Sports Medicine</em> — durability. Muñoz et al. (2014), <em>IJSPP</em> —
        triathlon intensity distribution and Ironman performance. Gabbett (2016),{" "}
        <em>Br. J. Sports Med</em> — training load and injury. Brandt et al. (2025),{" "}
        <em>Frontiers in Physiology</em> — HYROX physiology. Coffey &amp; Hawley (2017),{" "}
        <em>J. Physiol</em> — concurrent training. Zanini et al. (2025), <em>MSSE</em> — strength
        training and durability of running economy.
      </p>

      <div className="mt-12 flex flex-wrap gap-3 border-t border-zinc-200 pt-8 text-sm">
        <Link
          href="/onboarding"
          className="rounded-full bg-black px-5 py-2.5 font-medium text-white transition-colors hover:bg-zinc-800"
        >
          Build your program
        </Link>
        <a
          href="/duravel-training-science.pdf"
          className="rounded-full border border-zinc-300 px-5 py-2.5 font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
        >
          Download the PDF
        </a>
        <Link
          href="/science"
          className="rounded-full border border-zinc-300 px-5 py-2.5 font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
        >
          ← Back to Science
        </Link>
      </div>
    </main>
  );
}
