import type { DiagnosticQuestion, DiagnosticTest } from "./types";

/**
 * The questionnaire. Eight questions, no equipment.
 *
 * Every option carries evidence weighted at most 0.5, so the whole questionnaire
 * cannot outvote the test battery. What it is good at is the things a stopwatch
 * cannot see: where a race actually falls apart, and what the athlete has not
 * been doing.
 *
 * The options are written as things an athlete would recognise about themselves
 * — "my legs are gone but I'm not out of breath" — rather than as the physiology
 * they imply. Somebody who can correctly self-identify as VO2-limited does not
 * need this page.
 */
export const QUESTIONS: readonly DiagnosticQuestion[] = [
  {
    id: "where_it_breaks",
    prompt: "In a race, where does it actually fall apart?",
    why: "The failure point is the single most informative thing you know about yourself.",
    options: [
      {
        id: "later_runs",
        label: "The last few runs — I hold pace early, then it drains away",
        evidence: [
          { limiter: "durability", weight: 0.5 },
          { limiter: "aerobic", weight: 0.35 },
        ],
      },
      {
        id: "every_run_slow",
        label: "Every run feels slow, even the first one",
        evidence: [
          { limiter: "threshold", weight: 0.45 },
          { limiter: "aerobic", weight: 0.3 },
        ],
      },
      {
        id: "stations_legs",
        label: "The loaded stations — sled, lunges — my legs give out",
        evidence: [
          { limiter: "max_strength", weight: 0.5 },
          { limiter: "hypertrophy", weight: 0.3 },
        ],
      },
      {
        id: "stations_grip",
        label: "Grip and upper body — carries, sled pull, ski",
        evidence: [
          { limiter: "hypertrophy", weight: 0.45 },
          { limiter: "max_strength", weight: 0.3 },
        ],
      },
      {
        id: "breathing",
        label: "I'm redlined and gasping from about halfway",
        evidence: [
          { limiter: "vo2", weight: 0.4 },
          { limiter: "threshold", weight: 0.35 },
        ],
      },
    ],
  },
  {
    id: "hard_km_feel",
    prompt: "At the end of a hard 1 km, what stops you?",
    why: "Separates a breathing ceiling from a muscular one — the two get confused constantly.",
    options: [
      {
        id: "lungs",
        label: "Breathing — I can't get enough air",
        evidence: [{ limiter: "vo2", weight: 0.45 }],
      },
      {
        id: "legs",
        label: "My legs — they're burning and won't turn over",
        evidence: [{ limiter: "threshold", weight: 0.4 }],
      },
      {
        id: "both",
        label: "Honestly both, about equally",
        evidence: [
          { limiter: "vo2", weight: 0.2 },
          { limiter: "threshold", weight: 0.2 },
        ],
      },
      {
        id: "pace",
        label: "Neither — I just can't hold the pace, it fades",
        evidence: [{ limiter: "aerobic", weight: 0.4 }],
      },
    ],
  },
  {
    id: "weekly_hours",
    prompt: "Honestly, how many hours a week have you trained for the last three months?",
    why: "Aerobic base is bought with time. Below about five hours, it is almost always the limiter.",
    options: [
      { id: "under5", label: "Under 5", evidence: [{ limiter: "aerobic", weight: 0.5 }] },
      { id: "5to8", label: "5 to 8", evidence: [{ limiter: "aerobic", weight: 0.3 }] },
      { id: "8to12", label: "8 to 12", evidence: [{ limiter: "threshold", weight: 0.2 }] },
      {
        id: "over12",
        label: "More than 12",
        evidence: [
          { limiter: "vo2", weight: 0.2 },
          { limiter: "max_power", weight: 0.2 },
        ],
      },
    ],
  },
  {
    id: "lifting",
    prompt: "How long since you lifted heavy — sets of five or fewer, genuinely hard?",
    why: "Strength decays quietly and is the cheapest thing on this list to get back.",
    options: [
      {
        id: "current",
        label: "It's in my week right now",
        evidence: [{ limiter: "max_power", weight: 0.25 }],
      },
      {
        id: "months",
        label: "A few months",
        evidence: [{ limiter: "max_strength", weight: 0.35 }],
      },
      {
        id: "year",
        label: "A year or more",
        evidence: [
          { limiter: "max_strength", weight: 0.5 },
          { limiter: "hypertrophy", weight: 0.3 },
        ],
      },
      {
        id: "never",
        label: "I've never really trained strength",
        evidence: [
          { limiter: "max_strength", weight: 0.5 },
          { limiter: "hypertrophy", weight: 0.4 },
        ],
      },
    ],
  },
  {
    id: "long_run",
    prompt: "Longest single run in the last month?",
    why: "Durability is built by repeated long exposure and nothing else substitutes for it.",
    options: [
      {
        id: "under5k",
        label: "Under 5 km",
        evidence: [
          { limiter: "durability", weight: 0.5 },
          { limiter: "aerobic", weight: 0.35 },
        ],
      },
      { id: "5to10", label: "5 to 10 km", evidence: [{ limiter: "durability", weight: 0.35 }] },
      { id: "10to16", label: "10 to 16 km", evidence: [{ limiter: "durability", weight: 0.15 }] },
      { id: "over16", label: "Over 16 km", evidence: [{ limiter: "vo2", weight: 0.2 }] },
    ],
  },
  {
    id: "easy_pace",
    prompt: "On an easy run, can you hold a full conversation?",
    why: "If easy runs are not easy, the aerobic base never gets built and everything else is compromised.",
    options: [
      { id: "yes", label: "Yes, comfortably", evidence: [] },
      {
        id: "sentences",
        label: "Short sentences only",
        evidence: [{ limiter: "aerobic", weight: 0.35 }],
      },
      {
        id: "no",
        label: "Not really — my easy pace is fairly hard",
        evidence: [{ limiter: "aerobic", weight: 0.5 }],
      },
      {
        id: "no_easy",
        label: "I don't really do easy runs",
        evidence: [
          { limiter: "aerobic", weight: 0.5 },
          { limiter: "durability", weight: 0.3 },
        ],
      },
    ],
  },
  {
    id: "wall_balls",
    prompt: "Wall balls at race weight — what happens?",
    why: "The last station, and the one that most often turns a good race into a bad one.",
    options: [
      { id: "unbroken", label: "I can go unbroken or close to it", evidence: [] },
      {
        id: "sets",
        label: "I break into sets but keep moving",
        evidence: [{ limiter: "hypertrophy", weight: 0.25 }],
      },
      {
        id: "grind",
        label: "It becomes a grind of singles",
        evidence: [
          { limiter: "hypertrophy", weight: 0.45 },
          { limiter: "max_strength", weight: 0.25 },
        ],
      },
      {
        id: "shoulders",
        label: "My shoulders fail before my legs do",
        evidence: [{ limiter: "hypertrophy", weight: 0.5 }],
      },
    ],
  },
  {
    id: "sled",
    prompt: "The sled push at race weight?",
    why: "A sled that feels immovable is a strength problem; one that feels slow is a power problem.",
    options: [
      { id: "fast", label: "I can jog it", evidence: [] },
      {
        id: "steady",
        label: "Steady walk, no stops",
        evidence: [{ limiter: "max_power", weight: 0.25 }],
      },
      {
        id: "slow",
        label: "Slow grind with stops",
        evidence: [
          { limiter: "max_strength", weight: 0.45 },
          { limiter: "max_power", weight: 0.3 },
        ],
      },
      {
        id: "stuck",
        label: "It barely moves",
        evidence: [
          { limiter: "max_strength", weight: 0.5 },
          { limiter: "hypertrophy", weight: 0.3 },
        ],
      },
    ],
  },
];

/**
 * The test battery.
 *
 * Protocols are spelled out to the point of pedantry on purpose. The commonest
 * way a self-administered benchmark goes wrong is not dishonesty — it is an
 * athlete running their "5 k time trial" downhill, on fresh legs, after three
 * rest days, and then wondering why the prescribed paces are impossible.
 *
 * Spread them across a week. Running two of these on one day measures your
 * recovery, not your fitness.
 */
export const TESTS: readonly DiagnosticTest[] = [
  {
    id: "fiveKSec",
    name: "5 km time trial",
    measures:
      "Aerobic fitness and threshold. The anchor every prescribed run pace is computed from.",
    protocol: [
      "Flat route or a track. Not downhill.",
      "15 min easy warm-up with 3×20 s strides.",
      "5 km as hard as you can hold evenly — do not start fast.",
      "Rested: no hard session the day before.",
    ],
    unit: "time",
    placeholder: "21:40",
  },
  {
    id: "oneKSec",
    name: "1 km max effort",
    measures:
      "Top-end speed. Compared against your 5 k, it separates a weak ceiling from a weak engine.",
    protocol: [
      "Same route as the 5 k, fully warmed up.",
      "1 km flat out.",
      "A different day from the 5 k — at least 48 h apart.",
    ],
    unit: "time",
    placeholder: "3:52",
  },
  {
    id: "decouplingPct",
    name: "Aerobic decoupling",
    measures:
      "How well your aerobic base holds up. The clearest single read on base quality there is.",
    protocol: [
      "60 min steady run in Zone 2, flat, no stops.",
      "Split it in half. Note average pace and average heart rate for each half.",
      "Decoupling = the percentage change in pace-per-heartbeat from first half to second.",
      "Most watches compute this directly; under 5% is a solid base.",
    ],
    unit: "percent",
    placeholder: "4.2",
    needs: "Heart-rate monitor",
  },
  {
    id: "freshKmSec",
    name: "1 km fresh (control)",
    measures: "The control half of the durability test below. Meaningless on its own.",
    protocol: [
      "Fully warmed up, legs fresh.",
      "1 km at hard-but-repeatable effort — NOT maximal.",
      "Note the effort so you can repeat it.",
    ],
    unit: "time",
    placeholder: "4:15",
  },
  {
    id: "compromisedKmSec",
    name: "1 km compromised",
    measures: "Compromised running — the quality this sport is actually about.",
    protocol: [
      "100 wall balls at race weight, as fast as you can.",
      "Straight into 1 km at the SAME effort you used for the fresh one.",
      "No rest between. The gap between the two is the measurement.",
    ],
    unit: "time",
    placeholder: "4:48",
    needs: "Wall ball",
  },
  {
    id: "squat3Rm",
    name: "Back squat 3RM",
    measures: "Maximum strength, the force ceiling every loaded station draws from.",
    protocol: [
      "Work up in singles and doubles over 20 min.",
      "Heaviest 3 reps you can complete with good depth and no grinding.",
      "Stop if bar speed collapses — a missed rep measures nothing.",
    ],
    unit: "number",
    placeholder: "140",
    needs: "Barbell and rack",
  },
  {
    id: "broadJumpCm",
    name: "Standing broad jump",
    measures: "Explosive power — how fast you can express the strength you have.",
    protocol: [
      "From a standstill, feet together, no run-up.",
      "Measure to the back of the heel on landing.",
      "Best of five, full recovery between.",
    ],
    unit: "number",
    placeholder: "240",
  },
  {
    id: "wallBallsUnbroken",
    name: "Max unbroken wall balls",
    measures: "Muscular endurance in the shoulders and quads — the last station of the race.",
    protocol: [
      "Race weight, race target height.",
      "Go until you break. One set, no rest.",
      "Count only reps that hit the target.",
    ],
    unit: "number",
    placeholder: "45",
    needs: "Wall ball",
  },
  {
    id: "ski500Sec",
    name: "500 m SkiErg",
    measures:
      "Upper-body power and capacity — where HYROX bleeds time and running training never reaches.",
    protocol: ["5 min easy on the machine first.", "500 m flat out.", "Damper 5–7."],
    unit: "time",
    placeholder: "1:45",
    needs: "SkiErg",
  },
];
