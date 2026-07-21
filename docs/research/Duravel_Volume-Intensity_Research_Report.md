# Training Load, Volume, and Intensity in Hybrid and Endurance Sport

## An Evidence Review and Prescriptive Framework for HYROX, DEKA, Olympic Triathlon, Half-Ironman, and Ironman

*Prepared for Duravel · July 2026*

---

## Executive Summary

The central question this report answers is deceptively simple: **can an athlete achieve the same training effect from ten hours a week as from forty, by training harder in the time available?** The honest, evidence-based answer is *partly* — and the boundaries of that "partly" are the most important thing a programming engine can encode.

Three findings organize everything that follows.

**First, training load is not a single fungible number, even though we treat it like one.** Every load metric in use — Banister's TRIMP, Foster's session-RPE load, Coggan's Training Stress Score (TSS), Skiba's running stress score — reduces a session to intensity × duration, with intensity raised to a power (an exponential of heart-rate reserve in TRIMP; a fourth power of normalized power in TSS). That non-linear weighting is exactly why a short, hard session can *numerically* equal a long, easy one. But the equality is a bookkeeping convenience, not a physiological identity. Two sessions with identical load scores can drive different adaptations, because the body responds to the *pattern* of the stimulus, not just its integral.

**Second, intensity substitutes for volume for some adaptations and not others.** For maximal oxygen uptake (VO₂max) and general cardiometabolic health, the substitution is remarkably strong: controlled trials show that roughly 90% of endurance training volume can be removed and, if the remaining ~10% is performed at near-maximal intensity, VO₂max and mitochondrial adaptations are largely preserved (Gibala, Burgomaster, Gillen). One study reproduced a full 50-minute moderate session's VO₂peak gain with about *one minute* of hard work per session. But when total work is held constant, higher intensity produces *superior* mitochondrial adaptation (MacInnis 2017), while capillary density, plasma volume, cardiac remodeling, fat-oxidation capacity, connective-tissue robustness, and — above all — *durability* (resistance to physiological drift over hours) are driven by accumulated low-intensity volume and cannot be bought with intensity at any price.

**Third, the losses from trading volume for intensity scale with event duration and athlete training age.** For a two-minute CrossFit metcon or a general-fitness goal, intensity is nearly a full substitute for volume. For a five-to-seventeen-hour Ironman, it is not: long-course performance correlates with *accumulated low-intensity volume* at roughly r = −0.9 (Muñoz 2014), because the race is won on fat oxidation, durability, and structural resilience — all volume-gated. And the well-trained athlete has already harvested the fast, intensity-driven gains; further progress requires the slow, volume-driven adaptations that most low-volume HIIT studies (conducted in untrained subjects) never measured.

The practical synthesis is a **load-and-distribution framework** that does three things at each weekly-time budget (5, 10, 20, 30, and 40 hours): it sets a realistic weekly load target, it prescribes an intensity distribution that shifts systematically from threshold/pyramidal at low volume toward strongly polarized at high volume, and it names explicitly what each budget *cannot* buy — so the athlete (and the engine) makes an informed trade rather than an invisible one. The report closes with complete 5-sport × 5-budget prescription matrices and a specification for encoding this logic in Duravel's programming engine.

A note on confidence: the quantitative core of this report is drawn from peer-reviewed primary sources, and claims are flagged where the evidence is a single small study, a coaching consensus, or a figure that could not be verified to primary source. HYROX physiology in particular rests on a single N=11 study (Brandt 2025), and no laboratory study of DEKA yet exists; those prescriptions lean more on transferable physiology and coaching judgment than on direct evidence, and are labeled as such.

---

## 1. Introduction and Scope

Endurance and hybrid athletes face a resource-allocation problem before they face a physiological one. Time is the binding constraint for almost everyone below the professional ranks, and the market of training advice offers two competing answers to what to do with a limited budget: accumulate volume (the "miles make champions" tradition of distance running, rowing, and cycling), or concentrate intensity (the low-volume HIIT movement, popularized from the Gibala laboratory and adopted enthusiastically by time-crunched athletes and the CrossFit world).

Both camps are partly right, and the disagreement persists because they are often measuring different outcomes in different populations over different timeframes. This report resolves the disagreement into a single coherent model by asking three linked questions:

1. **How do we quantify training load** such that a volume-heavy week and an intensity-heavy week can be compared on a common scale — and what does that scale hide?
2. **Where along the volume–intensity trade-off does each physiological adaptation live** — which respond to intensity, which require volume, and which plateau?
3. **Given a fixed weekly time budget, what is the load-and-intensity prescription** that maximizes performance for a specific event, and what does that prescription knowingly sacrifice?

The events in scope span a wide duration range, and duration turns out to be the master variable that determines how the volume–intensity trade resolves:

| Event | Typical elite duration | Dominant energy contribution | Volume-dependence of performance |
|---|---|---|---|
| DEKA STRONG | ~10–14 min | Glycolytic / muscular-endurance | Low |
| DEKA MILE | ~16–22 min | Mixed power-endurance | Low–Moderate |
| DEKA FIT | ~28–37 min | Glycolytic-oxidative | Moderate |
| HYROX | ~52–90 min | Aerobic-dominant (~70–80% of race) with repeated supra-threshold spikes | Moderate–High |
| Olympic triathlon | ~1:45–2:15 | Aerobic-dominant, threshold-rich | High |
| Half-Ironman (70.3) | ~3:45–5:30 | Aerobic, sub-threshold | High |
| Ironman (140.6) | ~8:00–17:00 | Aerobic, fat-oxidation and durability limited | Very high |

The report treats CrossFit as a reference point on the short/glycolytic end of the spectrum rather than as a prescription target, per the requested scope. A recurring theme is that the same weekly-hour budget produces very different optimal programs across this table: five hours a week is a *complete* training solution for DEKA STRONG and a *survival-only* dose for Ironman.

A terminology note used throughout: unless stated otherwise, **"Zone 1 / Z1"** means below the first lactate or ventilatory threshold (LT1/VT1) — genuinely easy, conversational, fat-oxidation-dominant work. This corresponds to what popular culture calls "Zone 2 training." **"Zone 2 / Z2"** here means the *threshold* band between LT1 and LT2 (the "gray zone" / tempo / sweet spot). **"Zone 3 / Z3"** means above the second threshold (LT2/VT2/critical power) — hard intervals and race-pace work. This is the three-zone model used in the sport-science intensity-distribution literature (Seiler), and getting it straight is essential to reading the prescriptions correctly.

---

## Part I — Quantifying Training Load: The Common Currency and What It Hides

### 1.1 The load metrics and their mathematics

Every attempt to compare a volume-heavy week against an intensity-heavy week depends on a metric that collapses a session into a single number. All the metrics in serious use share one architecture — **internal load = f(intensity) × duration** — and differ only in how they weight intensity. Understanding that weighting is the key to understanding why "short and hard" can equal "long and easy" on paper.

**Banister's TRIMP (Training Impulse).** The original impulse metric. TRIMP = D × ΔHR × Y, where D is duration in minutes, ΔHR is the fraction of heart-rate reserve [(HR_ex − HR_rest)/(HR_max − HR_rest)], and Y is a non-linear weighting factor derived from the blood-lactate profile: Y = 0.64·e^(1.92·ΔHR) for men and 0.86·e^(1.67·ΔHR) for women (Banister 1991; Morton, Fitz-Clarke & Banister 1990). The *exponential* term is the crucial feature — each unit of heart-rate reserve at high intensity is worth disproportionately more than the same unit at low intensity, mirroring the exponential rise of blood lactate with intensity.

**Foster's session-RPE (sRPE) load.** The most practical and modality-agnostic metric: Load (arbitrary units, AU) = session RPE (0–10 CR-10 scale) × session duration in minutes (Foster et al. 2001). Its great virtue for a hybrid platform is that it works identically for a run, a swim, a barbell session, or a HYROX station simulation — anywhere a heart-rate or power model breaks down, RPE still applies. It validates well against HR-based TRIMP across sports (r ≈ 0.5–0.9). Two derived constructs matter for injury/overtraining monitoring: **training monotony** = weekly mean daily load ÷ its standard deviation, and **training strain** = weekly total load × monotony (Foster 1998).

**Coggan's Training Stress Score (TSS).** The cycling standard, now extended to running (rTSS). TSS = (t × NP × IF)/(FTP × 3600) × 100, which reduces to TSS = (t_seconds × IF²)/3600 × 100, so that **100 TSS = one hour at functional threshold power**. The intensity factor IF = NP/FTP, and Normalized Power (NP) is itself a fourth-power rolling average — 30-second rolling power values are raised to the fourth power, averaged, and the fourth root taken. Like TRIMP's exponential, this fourth-power weighting deliberately inflates the contribution of high-intensity surges.

**Edwards' and Lucia's summated heart-rate-zone TRIMPs.** Simpler, linear alternatives. Edwards (1993) assigns integer weights 1–5 to five %HRmax zones and sums minutes × weight. Lucia et al. (2003) use three zones bounded by ventilatory thresholds with weights 1, 2, 3. Both are transparent but *linear*, and therefore systematically under-credit very high intensity relative to the exponential/fourth-power metrics — a subtle but important bias when comparing polarized against threshold programs.

**Skiba's GOVSS / running stress.** For running without a power meter, Skiba (2006) built an analogue to TSS using a lactate-normalized power derived from velocity and grade, with the empirically fitted relationship %Lactate = (%Power at threshold)^3.52 (R² = 0.865). The ~3.5 exponent is the running-specific version of the same non-linear intensity weighting.

The takeaway for the engine: **the choice of metric changes the answer.** A polarized program (lots of easy plus a little very-hard) accrues more load under exponential metrics (TRIMP, TSS) than under linear ones (Edwards, Lucia), because the exponential metrics reward the very-hard fraction disproportionately. Duravel should standardize on one internal metric — session-RPE load is recommended for its cross-modal validity — and treat cross-modality equivalence as a planning heuristic, not a physiological law.

### 1.2 The fitness–fatigue model: why more load is not monotonically better

Load is an input; performance is the output, and the mapping between them is not linear. The dominant model is Banister's impulse-response (fitness-fatigue) system (Calvert, Banister et al. 1976), in which performance is the *difference* of two exponentially decaying traces driven by the same load impulses:

Performance(t) = p₀ + k₁·Σ w(i)·e^(−(t−i)/τ₁) − k₂·Σ w(i)·e^(−(t−i)/τ₂)

where w(i) is the daily load, τ₁ is the fitness decay time constant (~45–50 days), τ₂ is the fatigue decay constant (~11–15 days), and typically k₂ > k₁ (fatigue is larger in magnitude but shorter-lived than fitness). This structure explains three things a programming engine must respect:

- **Fatigue masks fitness.** Adding load raises fitness *and* fatigue; because fatigue is the larger term short-term, piling on load can *lower* measured performance until the load is reduced. This is the quantitative basis for tapering — cut load and fatigue decays faster than fitness, so performance rises. The tapering meta-analysis (Bosquet 2007; 2023 update) confirms the optimal taper reduces volume 41–60% over 8–14 days *while maintaining intensity*, improving time-trial performance by a moderate-to-large effect (SMD ≈ −0.5 to −1.5).
- **Diminishing returns are structural.** Adaptation saturates as fitness rises; the same absolute load yields progressively less adaptation in a fitter athlete (baseline fitness is the single strongest predictor of how much an athlete will gain from a given stimulus — Mølmen 2025). Doubling load never doubles adaptation.
- **The operational instantiation is CTL/ATL/TSB.** TrainingPeaks' Performance Management Chart is Banister's model in production: Chronic Training Load (42-day exponentially weighted load) as "fitness," Acute Training Load (7-day) as "fatigue," and Training Stress Balance (CTL − ATL) as "form." Duravel's engine can adopt the same two-time-constant structure natively.

### 1.3 The acute:chronic workload ratio — a monitoring heuristic, not a law

Because load drives both adaptation and injury, the *rate of change* of load matters. Gabbett's acute:chronic workload ratio (ACWR = 1-week load ÷ 4-week rolling average load) proposes a "sweet spot" of 0.80–1.30 and a "danger zone" above 1.50, where injury risk in the following week rises sharply (often cited as 2–4× at ACWR > 1.5). The framework's enduring insight — the "training-injury prevention paradox" — is that **high chronic load is protective**: a large aerobic base raises the denominator and buffers the athlete against the spikes that actually cause injury. An all-intensity, low-volume program is structurally dangerous precisely because it keeps the chronic base low, so any hard week is a relative spike.

The caveat, and it is a serious one, is that ACWR has been methodologically challenged: Lolli et al. (2019) showed the coupled ratio is mathematically self-correlated (the acute period is part of the chronic period), inflating apparent associations, and Impellizzeri et al. (2020) catalogued further artefacts of the ratio construction and arbitrary time windows. The engine should therefore treat ACWR as a *soft guardrail for flagging risky load progressions* — an uncoupled or exponentially-weighted version is preferable — not as a causal target to optimize.


---

## Part II — The Volume–Intensity Dose-Response: Where Substitution Holds and Where It Breaks

### 2.1 The strong case for substitution: low-volume, high-intensity training

The evidence that intensity can replace a large fraction of volume — for specific outcomes — is genuinely striking, and it is the empirical engine behind the entire time-crunched training movement.

The foundational results come from the Gibala and Burgomaster laboratories. Burgomaster et al. (2005) had subjects perform just six sessions of sprint-interval training (4–7 × 30-second all-out cycling sprints) over two weeks and saw muscle citrate synthase (a mitochondrial marker) rise ~38% and cycle endurance capacity roughly double. Gibala et al. (2006) then showed that a sprint-interval group performing about **90% less total work** than an endurance group matched it on muscle oxidative capacity and time-trial performance. Burgomaster et al. (2008) extended this to six weeks and confirmed comparable oxidative-enzyme increases and substrate-use adaptations between low-volume sprint training and traditional endurance training at roughly a tenth of the volume.

The single most vivid demonstration is Gillen & Gibala (2016): twelve weeks comparing sprint-interval training (three 20-second all-out efforts inside a ten-minute session — about one minute of genuinely hard work) against moderate continuous training (45 minutes at ~70% HRmax). **Both raised VO₂peak by ~19%**, with similar improvements in insulin sensitivity and mitochondrial content, at a fivefold difference in time and volume. Reduced-exertion protocols (REHIT — Metcalfe, Vollaard) push the minimum dose even lower, improving VO₂max ~15% on two 10–20-second sprints per session.

The mechanism is that VO₂max and mitochondrial signaling respond strongly to the *metabolic disturbance* that intense work produces efficiently — high recruitment of muscle fibers, large swings in calcium, AMP:ATP ratio, and reactive oxygen species that trigger PGC-1α and mitochondrial biogenesis. Per hour invested, intense work is roughly 3–4× more efficient than endurance work for mitochondrial content (Mølmen 2025 meta-regression). For an athlete whose binding constraint is time, and whose goal is aerobic power or metabolic health, **this is a real and large substitution effect.**

### 2.2 The limits of substitution: where the model breaks

The substitution story has three important boundaries, and a programming engine that ignores them will systematically mis-serve long-course athletes.

**Boundary 1 — At matched work, intensity and volume drive *different* adaptations, and neither is a full substitute.** The cleanest experiment is MacInnis et al. (2017), a within-subject single-leg cycling study where one leg trained with intervals and the other with continuous work *matched for total work*. The interval leg gained far more mitochondrial adaptation (citrate synthase +39% vs +11%; respiration +22% vs −9%). So intensity is not merely a time-efficient route to the same endpoint — at equal load it produces a *different, larger* mitochondrial response. Conversely, capillarization runs the other way: endurance/volume training produces the largest capillary-density gains, exceeding HIIT and sprint training by ~5–13% (Mølmen 2025), because capillary growth responds to *sustained shear stress* that only duration provides. A single "load" number cannot capture both facts. Load is fungible *within* an adaptive pathway, not across all of them.

**Boundary 2 — The low-volume HIIT literature is dominated by untrained subjects over short timeframes.** This is the most important caveat for a platform serving committed athletes. The dramatic "90% less volume, same result" findings were overwhelmingly obtained in previously untrained or recreationally active people over 2–12 weeks. Mølmen's 2025 meta-regression found that **baseline fitness is the single strongest predictor of adaptation magnitude**, and that in well-trained individuals, mitochondrial content moved *only* with sprint training while capillarization did not increase further at all. In other words, the trained athlete has already banked the fast, intensity-driven gains; the remaining performance to be won lives in the slow, volume-driven adaptations. VO₂max gains across modalities cluster around 9–12% and then plateau; endurance's advantage in the trained state is the *durability and long-lasting nature* of the adaptation, not a higher peak.

**Boundary 3 — Total load itself is volume-dominated, so "load-matching" a low-volume week is arithmetically impossible past a point.** Consider session-RPE load (RPE × minutes). A 20-hour polarized week accumulates on the order of 5,000 AU; to match that in 5 hours (300 minutes) would require an average session RPE above 16 on a 10-point scale — a physical impossibility. The honest framing is not "you can get the same load in less time by going harder" but "you can get the same *specific fast-adapting outcomes* (VO₂max, mitochondrial content) in less time by going harder, while accumulating a fraction of the total load and forgoing the volume-gated adaptations." The engine should represent this as **partial, outcome-specific substitution with a hard ceiling**, not linear fungibility.

### 2.3 Diminishing returns and the non-linearity of the dose-response

The dose-response curve of adaptation to load is saturating, not linear. Early and untrained gains are large; each additional increment of load yields less. Mølmen's finding that untrained subjects gained 6–20% more than trained subjects from the same protocols is the empirical signature of this curve. The per-hour efficiency of volume falls as volume rises, which is precisely why elite endurance athletes accumulate enormous volumes at very low intensity — they are operating far out on the flat part of the curve, where the *only* remaining lever is more low-cost volume, because more intensity would exceed their recovery ceiling (Part IV).

This produces a counter-intuitive but well-supported conclusion that the prescriptions in Part VI encode: **the optimal intensity distribution is not fixed — it must scale with volume.** At low volume, the athlete is on the steep part of the curve and intensity is the efficient lever. At high volume, intensity is capped by recovery and the marginal hour must be easy. The next section makes this quantitative.

---

## Part III — Intensity Distribution and How It Must Scale With Volume

### 3.1 The four distribution models

Given a total load, how should it be spread across the intensity zones? The literature defines four canonical patterns on the three-zone model:

- **Polarized (POL):** roughly 75–80% Z1, ≤5% Z2, 15–20% Z3. A bimodal "lots of easy, meaningful hard, little middle" pattern. Seiler's shorthand is "80/20."
- **Pyramidal (PYR):** volume decreases as intensity rises, e.g. ~80% Z1, ~15% Z2, ~5% Z3 — more threshold work than the polarized model, and Z2 is *not* minimized. This is what most elite endurance athletes actually do in base/preparation phases.
- **Threshold (THR):** a heavy concentration of work in Z2 (the classic "sweet spot" / tempo emphasis), e.g. ~45–55% Z2.
- **High-intensity (HIIT):** disproportionate Z3, minimal Z2, and reduced total volume — the low-volume model of Part II.

The descriptive foundation is Seiler & Kjerland (2006), who tracked elite cross-country skiers and found ~75% of work clearly below the first threshold, only ~6–8% in the threshold zone, and ~15–20% high-intensity, regardless of whether measured by heart rate, RPE, or blood lactate. Fiskerstrand & Seiler's (2004) thirty-year retrospective of Olympic-medalist rowers found that, over three decades, low-intensity volume *rose* while high-intensity volume *fell* — and VO₂max and performance improved ~10–12%. Elites got better by adding easy volume and cutting hard volume.

### 3.2 What the controlled trials show

The interventional evidence modestly favors polarized training for aerobic power, but is more equivocal for race performance:

- **Stöggl & Sperlich (2014)**, a four-arm trial in well-trained endurance athletes, found polarized training produced the largest gains in VO₂peak (+11.7%), time-to-exhaustion (+17.4%), and peak power — beating threshold, high-volume, and HIIT models. The important confound is that the polarized arm was not volume-matched to the others (it carried both more total volume *and* meaningful high intensity).
- **Neal et al. (2013)**, a within-subject crossover in trained cyclists, found polarized (80/0/20) beat threshold (57/43/0) on peak power (+8% vs +3%), lactate threshold (+9% vs +2%), and high-intensity capacity (+85% vs +37%) — even though the threshold arm did slightly more hours.
- **Muñoz et al. (2014)** in runners found both polarized and threshold-heavy training improved 10 km time, with polarized superior specifically among the best-adhering athletes.
- The **meta-analytic verdict** is narrower than the enthusiasm suggests. Silva Oliveira et al. (2024) found polarized superior for VO₂peak (SMD 0.24, larger in highly-trained athletes and short blocks) but **statistically equivalent to pyramidal/threshold for time-trial performance** (SMD −0.01). Rosenblat et al. (2019) found a moderate polarized advantage over threshold for time-trial performance (ES −0.66) but from only three small trials.

The honest synthesis: **intensity distribution is a fine-tuning lever, not the master switch.** Total volume and training frequency are the primary drivers (Seiler's "hierarchy of endurance training needs" places frequency/volume above intensity distribution); polarized organization extracts modestly more aerobic power from a given volume, especially in trained athletes, but pyramidal remains what most elites actually do in base phases and is not meaningfully inferior for race outcomes.

### 3.3 The governing principle: distribution scales with volume

The single most useful organizing idea for a programming engine is this: **the absolute amount of high-intensity (Z3) work an athlete can absorb and recover from is limited and only weakly related to total hours.** It is set by recovery capacity — roughly two to four quality sessions per week, a few hours at most. Therefore, as total volume rises, that fixed hard-work quantity becomes a *smaller percentage*, and the distribution migrates automatically from threshold/pyramidal toward polarized. Conversely, at low volume you cannot fill the week with easy work and still get an adequate stimulus, so the mix must skew toward more Z2/Z3.

This yields a volume-dependent distribution schedule (a coaching-consensus heuristic grounded in the mechanistic data, to be read as such):

| Weekly hours | Practical model | Approx. Z1 / Z2 / Z3 | Rationale |
|---|---|---|---|
| 3–5 h (time-crunched) | Threshold-leaning **pyramidal**; 2–3 quality sessions | ~60–75 / 15–25 / 10–15 | Too few hours to justify mostly-easy work; stimulus must be concentrated. Intensity substitutes for missing volume (Part II). |
| 6–9 h (committed amateur) | **Pyramidal**, 2 quality sessions | ~75–80 / 12–18 / 5–10 | Enough base to protect easy volume; threshold work still present. |
| 10–15 h (sub-elite) | **Pyramidal** base → **polarized** build | ~80–85 / 5–12 / 8–15 | Base grows; hard work stays ~2–3 sessions so its share falls; minimize gray zone near competition. |
| 20–30+ h (elite) | Strongly **polarized**, huge Z1 base | ~85–90 / 2–5 / 8–12 | Tolerable Z3 is capped by recovery; the remaining hours *must* be easy. Matches Seiler/Fiskerstrand elite data. |

A periodization overlay sits on top: even within one athlete, base phases run more pyramidal (more threshold work) and competition-specific phases move toward polarized (sharpen Z3, minimize the gray zone). The best runner evidence suggests a *sequence* — pyramidal base then polarized sharpening — maximizes gains.

### 3.4 The maintenance asymmetry: the one variable you must not cut

A final, decisive piece of evidence tells the engine how to handle time-reduced weeks. The classic Hickson studies (1981, 1982, 1985) dissociated the three training variables in trained subjects: cutting **frequency** (from 6 to 2–4 days/week) or **duration** (from 40 to 13 minutes) for 15 weeks *maintained* VO₂max, but cutting **intensity** by a third or two-thirds *reduced* VO₂max and endurance. Houmard et al. (1990) confirmed that a ~70% volume reduction, with intensity maintained, held VO₂max and 5 km race time in runners for three weeks. The tapering meta-analysis reaches the same conclusion: reduce volume 41–60%, *maintain intensity*, and performance improves.

The rule the engine should encode: **when time collapses, protect intensity and cut volume — never the reverse.** A maintained-intensity program of one to two quality sessions per week on ~50–70% reduced volume holds VO₂max and threshold for roughly two to four months. Beyond that horizon, and for the base traits (LT1, fat oxidation, economy, durability, capillarization), volume must return — which is the subject of Part IV.


---

## Part IV — What Volume Uniquely Buys, and the Costs of Trading It for Intensity

If intensity can hold VO₂max and mitochondrial content on little volume, why do the best endurance athletes in the world train 20–40 hours a week, most of it easy? Because a set of performance-decisive adaptations are *volume-gated* — they respond to accumulated time, not to intensity — and because high intensity carries systemic costs that cap how much of it any athlete can absorb. This section is the counterweight to Part II, and it is what makes the low-volume trade a genuine trade rather than a free lunch.

### 4.1 The volume-gated adaptations

**Capillarization.** The density of capillaries surrounding muscle fibers governs oxygen and substrate delivery and metabolite clearance. It responds to sustained shear stress, and in the meta-regression evidence endurance training produces the largest gains (~13%), exceeding HIIT and especially sprint training; in well-trained athletes, short high-intensity work does not increase it further at all (Mølmen 2025). This is a duration-dependent adaptation that intensity cannot reproduce.

**Total mitochondrial content.** Although intensity is more efficient *per hour* for mitochondrial signaling, *total* content is driven by total volume and frequency (6 > 4 > 2 sessions/week), and Bishop's position — supported by the meta-regression — is that "training volume is more important than training intensity to promote increases in mitochondrial content." Critically, these adaptations *reverse* when volume is withdrawn (Granata & Bishop 2016): they must be maintained by ongoing volume, not banked once.

**Fat-oxidation capacity.** Maximal fat oxidation and the intensity at which it occurs rise with accumulated low-intensity ("Zone 1") volume, tied to the mitochondrial and capillary adaptations above. For any event lasting more than ~90 minutes, the ability to spare glycogen by oxidizing fat is performance-decisive, and it is built by hours, not intervals.

**Cardiac remodeling and plasma volume.** Eccentric left-ventricular enlargement and the associated rise in stroke volume develop slowly over many months of accumulated endurance training (Arbab-Zadeh 2014, a one-year progressive study). Plasma-volume expansion (~10%) raises cardiac filling and aids thermoregulation. Both are volume-and-duration-sensitive central adaptations that brief intense work does not produce.

**Exercise economy.** Economy — the oxygen or energy cost of a given pace — is a stronger discriminator of performance among athletes with similar VO₂max than VO₂max itself, and it improves slowly over years of sport-specific volume through neuromuscular and elastic-tissue refinement. It is an exposure-dependent, largely volume-driven adaptation.

**Connective tissue — the slow tissue.** Tendon, ligament, and bone remodel far more slowly than muscle or myocardium (Kjaer & Magnusson 2009): gross tendon adaptation requires very prolonged loading, and bone remodels on a multi-month cycle. This creates a *capacity-mismatch window* — the cardiovascular and muscular systems can absorb an intensity jump within weeks, but the tendons and bones cannot, which is the biomechanical basis for tendinopathy and bone-stress injury when intensity is added faster than tissue remodels. Structural robustness must be *accumulated*; it cannot be bought with intensity.

**Durability — the fourth parameter.** The most important recent addition to endurance science is *durability*: the resistance to deterioration of physiological characteristics (economy, thresholds, VO₂ kinetics) over prolonged exercise (Maunder, Seiler et al. 2021; Jones 2024). Critical power can fall ~10% (individual range 1–31%) after prolonged work, with significant decline appearing only after ~120 minutes. Durability is distinct from any fresh-state measurement — it is what separates athletes in the final third of a long race — and the emerging consensus is that it is built largely by *accumulated volume and time-in-zone*. This is the single trait most responsible for why Ironman rewards volume: the race is decided by who drifts least over eight-plus hours, and that resilience is a volume adaptation.

### 4.2 The systemic costs of intensity

Intensity is not merely less efficient at building these traits; it actively consumes the recovery capacity needed to sustain training, and it does so disproportionately.

**Autonomic and overtraining cost.** Seiler's central argument is that high-intensity work switches on a large sympathetic stress response that must be "repaid" in recovery, whereas low-intensity volume stays "under the stress radar." Heart-rate-variability research (Plews & Buchheit 2013) shows that progressive parasympathetic suppression flags maladaptation, and that functionally overreached athletes show blunted post-exercise parasympathetic reactivation. Seiler's warning — "one of the best ways to overtrain an organism is to subject it to daily stress at the same level" — identifies *monotonous intensity*, not volume, as the primary overtraining driver. This is why the highest-volume athletes in the world are also the most polarized: keeping intensity to ~20% of sessions is how they protect recovery while accumulating huge loads.

**Injury.** Beyond the ACWR-spike risk of Part I, intensity carries a distinct biomechanical injury signature. Nielsen's large prospective cohort (2024, >5,000 runners) found that when a single run exceeded the prior 30 days' longest run by more than 100%, injury risk rose 128%; even 10–30% jumps raised risk 64%. Malisoux's work identifies higher-intensity running as an injury factor independent of volume. High intensity on an inadequate chronic base is structurally the most injurious combination.

**Immune and endocrine cost.** The immune "J-curve" (Nieman) shows a 2–6× increase in upper-respiratory-infection risk in the week after a marathon or hard competition, with a dose-response to training load — an "open window" of immunosuppression that scales with intensity and load peaks. Overtraining is accompanied by disrupted cortisol, testosterone:cortisol ratio, and blunted hormonal responses to stimulation (Cadegiani & Kater 2017).

**Monotony, strain, and adherence.** Foster's monotony (mean load ÷ its variability) and strain (weekly load × monotony) metrics predict illness, injury, and plateau; all-intensity or same-every-day programs maximize both. High-RPE sessions are also psychologically harder to sustain, making all-intensity programs more burnout-prone. Polarized structures, by keeping most sessions easy and tolerable, are more sustainable — a real-world adherence advantage that compounds over a season.

### 4.3 What you lose, by athlete level and event

The trade is not uniform. The engine should weight it by both training age and event duration:

- **Untrained/novice athletes** lose the *least* physiologically from choosing intensity over volume — low-volume HIIT captures much of their early VO₂max and mitochondrial gain — but lose the *most* in injury terms, because their connective tissue and load tolerance are unprepared for intensity and spikes. For them the constraint is structural, not metabolic.
- **Trained/elite athletes** lose the *most* physiologically — they have hit the HIIT ceiling and forfeit the volume-only adaptations (cardiac remodeling, plasma volume, economy, capillarization, durability) that actually separate elites.
- **Masters/older athletes** lose on *recovery and tissue tolerance* — reduced capacity to absorb intensity strain and load spikes makes the volume-for-intensity trade riskier; volume-driven vascular and capillary adaptation is where they gain safely.
- **By event:** for short, glycolytic events (DEKA STRONG/MILE, CrossFit metcons) and general fitness, intensity substitutes well and the loss is small. For long-duration endurance (HYROX at the margin, and decisively 70.3 and Ironman), the loss is large, because these events are won on exactly the volume-gated adaptations that intensity cannot replace.

---

## Part V — Sport-Specific Demands and the Concurrent-Training Constraint

### 5.1 HYROX

HYROX is eight 1-kilometer runs alternated with eight functional stations (SkiErg, sled push, sled pull, burpee broad jumps, row, farmers carry, sandbag lunges, wall balls), in fixed order. Running is more than half the race distance and, because most stations last over two minutes, the total oxidative demand is roughly 70–80% of race time — HYROX is **aerobic-dominant.** Elite finish times run ~52–57 minutes (men's professional world record 51:59, women's 54:25 as of 2026); recreational finishers commonly take 75–95 minutes.

The one peer-reviewed physiological study (Brandt et al. 2025, N=11 recreational) is decisive on the profile even with its small sample: athletes spent ~80% of the race at ≥90% HRmax (peak 185 bpm), with blood lactate around 8.5 mmol/L — a sustained near-maximal, oxidative-dominant effort with repeated supra-threshold spikes. The performance correlations are the headline for programming: **VO₂max correlated with finish time at ρ = −0.71 and endurance-training volume at ρ = −0.68, while maximal strength correlated only weakly.** The authors conclude HYROX is "a HIFT modality with an emphasis on endurance capacity and moderate to low requirements in terms of maximum strength." The practical implication is that HYROX athletes need a strength/power *floor* to move fixed external loads efficiently, then endurance-dominant programming above it — not a strength *ceiling*.

The signature challenge is **"compromised running"**: run splits slow markedly across the race (athletes typically run 20–30 s/km slower in-race than fresh), a fatigue signature of cumulative station load. This is a *durability* problem, and it is the mechanistic justification for keeping heavy and plyometric strength in the plan despite the event being endurance-dominant (Section 5.4).

### 5.2 DEKA

DEKA comprises ten functional zones (reverse lunges, row, box jump-overs, med-ball sit-up throws, SkiErg, farmers carry, air bike, dead-ball overs, sled push/pull, weighted burpees) in three formats that sit at very different points on the volume–intensity spectrum:

- **DEKA STRONG** — ten zones back-to-back, no running, ~10–14 minutes: a glycolytic/anaerobic-power sprint.
- **DEKA MILE** — zones plus a 160 m run before each (~1 mile total), ~16–22 minutes: mixed power-endurance.
- **DEKA FIT** — zones plus a 500 m run before each (~5 km total), ~28–37 minutes: glycolytic-oxidative, the closest analogue to HYROX but ~40% shorter and therefore run at higher relative intensity.

No laboratory study of DEKA physiology exists — this is a genuine evidence gap, and the profiles above are inferred from format and duration. The programming consequence is clear regardless: DEKA STRONG and MILE invert the HYROX emphasis toward glycolytic power and greater strength volume, while DEKA FIT approaches HYROX programming at a higher-intensity, lower-total-volume setting.

### 5.3 CrossFit as a reference point

CrossFit's benchmark workouts are near-maximal glycolytic efforts on an aerobic base: signature metcons elicit 95–98% HRmax and blood lactate of 14–15 mmol/L, yet only 57–66% of VO₂max, because short couplets and triplets are power- and glycolytically-limited rather than oxygen-limited (Claudino 2018). Performance is predicted more by neuromuscular strength and strength-endurance than by aerobic capacity — the mirror image of HYROX. This is the clearest illustration of the report's duration thesis: the shorter and more glycolytic the event, the more intensity substitutes for volume and the more a strength/power emphasis pays.

### 5.4 The concurrent-training (interference) constraint

Hybrid athletes train strength and endurance simultaneously, and the two adaptations partly compete. The classic finding (Hickson 1980) was that concurrent endurance training blunted strength gains. The modern picture is more precise and more reassuring:

- **Maximal strength and hypertrophy are largely protected** in modern meta-analyses (SMD near zero), but **explosive power and rate-of-force-development are reliably impaired** (SMD ≈ −0.28). The vulnerable adaptation is power, not strength or size.
- The mechanism is **not** simple molecular antagonism (AMPK suppressing mTOR); acute human studies often fail to show the predicted molecular interference. Coffey & Hawley (2017) locate the effect largely in **residual fatigue and competition for recovery** — high endurance load consumes the recovery capacity needed to express and adapt to strength work.
- Interference **scales with endurance volume and intensity** (Fyfe, Bishop & Stepto 2014): very high endurance volume is what actually erodes power; moderate endurance does little. Running interferes more than cycling, partly through eccentric muscle damage.

The programming implications for hybrid athletes are direct. The explosive HYROX/DEKA stations (sleds, jumps, wall balls, weighted burpees) are exactly the elements concurrent training threatens, so they should be protected with **low-volume, high-quality strength/power work** (heavy or ballistic, low sets, far from failure) that delivers most of the neural benefit at minimal recovery cost — coexisting with high endurance volume far better than high-volume hypertrophy blocks. Hard endurance and hard strength should be separated by hours or days, and sequenced quality-first. And the volume-vs-intensity trade acquires a hybrid-specific dimension: an intensity-biased, lower-volume *endurance* approach can actually *protect* the power stations, while a high-mileage approach maximizes running at some risk to power output.

Crucially, strength training earns its place in an endurance-dominant HYROX plan through **durability**, not fresh economy. Zanini et al. (2025) found ten weeks of strength-plus-plyometric training left fresh running economy unchanged but roughly *halved* the economy decrement over 90 minutes (4.7% → 2.1%) and increased fatigued time-to-exhaustion by 35%. That is a direct pharmacological-strength answer to HYROX's compromised-running problem.

### 5.5 Triathlon, half-Ironman, and Ironman

Long-course triathlon is where volume-dependence is strongest and the evidence is cleanest. Elite training volumes scale with event duration: world-class Olympic-distance athletes may train ~15 hours/week (short-course rewards intensity and economy, so raw hours are lower than assumed), while professional Ironman athletes commonly train 25–35 hours/week, exceeding 40 in camps. Competitive age-group Ironman qualifiers typically train ~20 hours/week; mid-pack finishers ~12; documented minimalist programs complete Ironman on as little as ~6–10 hours.

The intensity distribution is pyramidal-shifting-to-polarized, dominated by low-intensity volume: a world-class Olympic athlete logged 82% Z1 / 7% Z2 / 11% Z3 (Cejuela 2022), and an elite Ironman squad averaged ~68% Z1 / 28% Z2 / 4% Z3 (Muñoz 2014). The most important single result for long-course programming comes from that Muñoz study: **time spent in Zone 1 correlated with faster Ironman finish at r ≈ −0.92, total volume at r ≈ −0.69, while more Zone 2 ("gray zone") correlated with *slower* times (r ≈ +0.94).** Accumulated low-intensity volume is the strongest trainable correlate of long-course performance, and gray-zone overreach is actively counterproductive.

Two boundary findings complete the picture. First, **diminishing returns are real even in long-course:** a survey of 99 amateurs found no meaningful finish-time difference between those training under 14, 14–20, and over 20 hours/week, and athletes reporting unintended weight loss/fatigue (overtraining flags) finished slower — suggesting ~14 hours as a practical amateur optimum. Second, **minimalist programs reliably deliver *finishing* but not *competing*:** four beginners completed an Ironman on ~6 hours/week (all finished, two in the top 15%), but the predictable tradeoffs of low volume — late-race durability failure, GI intolerance from too few long fueling rehearsals, and musculoskeletal fragility in the marathon — are exactly the volume-gated traits of Part IV, and they surface in the back half of the race where the event is actually decided.


---

## Part VI — The Prescriptive Framework: Load and Intensity by Sport and Time Budget

### 6.1 Methodology

The prescriptions below are built from four principles established in Parts I–V:

1. **Total load scales primarily with volume; intensity raises per-hour load but cannot close the gap.** Using session-RPE load (RPE 0–10 × minutes) with zone anchors of Z1 ≈ 3.5, Z2 ≈ 6.5, Z3 ≈ 8.5, and strength/power ≈ 6.5, the realistic weekly load bands are:

| Weekly time | Representative weekly load (session-RPE AU) | Load relative to 20 h |
|---|---|---|
| 5 h | ~1,500–1,900 | ~30% |
| 10 h | ~2,700–3,200 | ~55% |
| 20 h | ~5,000–5,600 | 100% |
| 30 h | ~7,000–7,800 | ~140% |
| 40 h | ~9,000–10,000 | ~180% |

The five-hour athlete operates at roughly a third of the twenty-hour athlete's total load *even when training much harder on average*. This is the arithmetic reality behind the report's core message: intensity buys back specific fast-adapting outcomes, not total load.

2. **Intensity distribution shifts from threshold-leaning pyramidal at low volume toward strongly polarized at high volume** (Section 3.3), because tolerable high-intensity work is capped by recovery at roughly 2–4 quality sessions regardless of total hours.

3. **Substitution is outcome-specific.** Low budgets preserve VO₂max, threshold, and neuromuscular quality; they progressively sacrifice the volume-gated traits (durability, fat oxidation, capillarization, connective-tissue robustness) in rough proportion to how far below the event's "volume demand" they fall.

4. **The trade's severity scales with event duration.** For DEKA and HYROX, a modest budget captures most of what matters; for Ironman, no amount of intensity compensates for missing volume in the back half of the race.

Each prescription names the realistic athlete level for that budget, because a 40-hour week is professional territory and a 5-hour week is a genuine solution only for the shortest events. Modality splits are given as approximate share of weekly hours. Strength/power is expressed as hours *inclusive* of the total budget.

### 6.2 A note on reading the tables

"Optimizes" is what the budget delivers well; "Sacrifices" is what it knowingly leaves on the table versus the event's ideal volume. "Anchor sessions" are the non-negotiable weekly stimuli. Intensity distribution is time-in-zone (Z1/Z2/Z3) across the *endurance* portion; strength/power sits outside the zone model.

---

### 6.3 HYROX

HYROX is aerobic-dominant with a strength/power floor (Section 5.1). Programming centers on running volume and station-specific conditioning ("compromised running"), with concentrated, low-volume strength/power to protect the explosive stations and build durability. Because the event is ~52–90 minutes, the volume demand is moderate — a well-constructed 10-hour week is genuinely competitive for age-group athletes, and returns above ~20 hours are small for all but elites chasing the podium.

| Budget | Modality split (approx.) | Intensity dist. (Z1/Z2/Z3) | ~Weekly load | Anchor sessions | Optimizes / Sacrifices | Realistic level |
|---|---|---|---|---|---|---|
| **5 h** | Run 45%, stations/compromised-run intervals 30%, strength/power 25% (1.25 h) | 55 / 25 / 20 | ~1,600 | 1 threshold-run + station circuit; 1 VO₂ interval (running or SkiErg/row); 1 heavy-strength 30–40 min | Optimizes VO₂max, threshold, station efficiency, neuromuscular floor / Sacrifices running durability, aerobic-base depth | Recreational; competitive Open finisher |
| **10 h** | Run 50%, stations 28%, strength/power 22% (2.2 h) | 70 / 15 / 15 | ~2,900 | 1 long compromised-run (station-run transitions); 1 threshold; 1 VO₂; 2 strength (1 heavy, 1 power/plyo) | Optimizes race-specific durability + all of the above / Sacrifices only the last few % of aerobic base | Advanced age-grouper; Pro-qualifier attainable |
| **20 h** | Run 55%, stations 25%, strength/power 20% (4 h) | 80 / 8 / 12 | ~5,200 | 2 long runs (1 compromised-run simulation), 1 threshold, 2 VO₂/station-VO₂, 2–3 strength/power, plus easy aerobic volume | Optimizes durability, aerobic base, full race simulation / Sacrifices little for this event | Elite / Pro |
| **30 h** | Run 55%, stations 22%, strength/power 18% (5.4 h), aerobic cross-training fills remainder | 85 / 4 / 11 | ~7,400 | As 20 h plus large easy-aerobic base (run + low-impact cross-training to manage impact load) | Optimizes maximal durability with impact-injury management / Diminishing returns; injury/impact risk becomes the limiter | Full-time Pro only |
| **40 h** | Run 50%, stations 20%, strength/power 15% (6 h), cross-training 15% | 88 / 3 / 9 | ~9,200 | Camp-style loading; impact managed via cross-modal aerobic volume | Optimizes nothing beyond 30 h for most; camp/peak-block use | Pro peak-block only; not sustainable |

HYROX-specific guardrail: running impact load, not metabolic load, is the binding constraint above ~20 hours. The engine should cap weekly running impact and route additional aerobic volume to SkiErg, row, and bike to keep building the aerobic base without overloading connective tissue.

---

### 6.4 DEKA (FIT / MILE / STRONG)

DEKA spans the widest internal range of any sport here (Section 5.2). STRONG (~10–14 min) is glycolytic-power-dominant and the most intensity-substitutable event in the report; FIT (~28–37 min) approaches HYROX programming; MILE sits between. The table below is written for **DEKA FIT** as the reference format, with explicit adjustments for STRONG and MILE beneath it.

| Budget | Modality split (approx.) | Intensity dist. (Z1/Z2/Z3) | ~Weekly load | Anchor sessions | Optimizes / Sacrifices | Realistic level |
|---|---|---|---|---|---|---|
| **5 h** | Run 35%, zone/circuit intervals 35%, strength/power 30% (1.5 h) | 45 / 25 / 30 | ~1,700 | 2 zone-circuit HIIT (race-pace intervals through the 10 zones); 1 heavy + 1 power strength; 1 threshold run | Optimizes glycolytic power, zone efficiency, VO₂max / Sacrifices little for FIT; nothing meaningful for STRONG | Recreational → competitive (fully sufficient for STRONG) |
| **10 h** | Run 40%, zones 32%, strength/power 28% (2.8 h) | 60 / 18 / 22 | ~3,000 | 2 zone circuits, 1 VO₂, 1 threshold, 1 long aerobic, 2–3 strength/power | Optimizes race-specific power-endurance and aerobic support / Sacrifices back-end aerobic base for FIT | Competitive age-grouper; elite for STRONG/MILE |
| **20 h** | Run 45%, zones 30%, strength/power 25% (5 h) | 72 / 10 / 18 | ~5,300 | Full race simulations, VO₂ blocks, threshold, aerobic base, structured strength/power | Optimizes everything DEKA FIT rewards / Sacrifices little | Elite (beyond STRONG/MILE needs) |
| **30 h** | Run 45%, zones 28%, strength/power 22% (6.6 h), cross-training remainder | 80 / 6 / 14 | ~7,300 | As 20 h plus easy aerobic volume; power maintained | Optimizes aerobic ceiling well past DEKA's demands / Strong diminishing returns for all formats | Over-prescribed for DEKA; Pro only |
| **40 h** | Not indicated | — | — | — | No DEKA-specific rationale; volume exceeds event demand | Not recommended |

DEKA format adjustments: for **STRONG**, shift ~10 points of Z1 into Z3 and add one strength/power session at every budget (it is a strength-endurance sprint); 5 hours is a complete, competitive program. For **MILE**, split the difference between STRONG and FIT. DEKA is the clearest case where *more than ~20 hours has no event-specific justification*.

---

### 6.5 Olympic-Distance Triathlon

Olympic distance (~1:45–2:15) is aerobic-dominant but threshold-rich; short-course rewards intensity and economy, so even elites train "only" ~15 hours/week. This makes it the endurance event where intensity substitutes best, and where a 10-hour week is highly competitive for age-groupers.

| Budget | Modality split (S/B/R + strength) | Intensity dist. (Z1/Z2/Z3) | ~Weekly load | Anchor sessions | Optimizes / Sacrifices | Realistic level |
|---|---|---|---|---|---|---|
| **5 h** | S 20% / B 40% / R 30% / strength 10% | 55 / 20 / 25 | ~1,650 | 2 threshold/VO₂ bricks; 1 hard swim; 1 short long-ride; strength maintenance | Optimizes VO₂max, threshold, race pace / Sacrifices aerobic base, swim technique volume | Recreational; sprint-focused |
| **10 h** | S 22% / B 42% / R 28% / strength 8% | 70 / 15 / 15 | ~2,900 | Weekly long ride + long run; 2 quality (VO₂/threshold) bricks; 2–3 swims; 1 strength | Optimizes competitive age-group readiness / Sacrifices only marginal base | Competitive age-grouper |
| **20 h** | S 25% / B 45% / R 25% / strength 5% | 80 / 8 / 12 | ~5,200 | Large Z1 base across all three; 2–3 quality sessions; full brick work | Optimizes base, economy, threshold, durability / Sacrifices little | Sub-elite / elite |
| **30 h** | S 25% / B 47% / R 23% / strength 5% | 85 / 5 / 10 | ~7,400 | Polarized elite structure; huge easy base; capped quality | Optimizes elite aerobic depth / Diminishing returns for Olympic distance | Elite / Pro |
| **40 h** | S 25% / B 48% / R 22% / strength 5% | 88 / 4 / 8 | ~9,200 | Camp/peak-block only | No Olympic-specific return beyond 30 h | Pro peak-block only |

---

### 6.6 Half-Ironman (70.3)

At ~3:45–5:30, 70.3 is decided by sub-threshold aerobic capacity and durability. Volume-dependence is high: a 10-hour week produces a solid finisher, but competing (holding pace in the back half of the run) increasingly requires the volume-gated durability of Part IV.

| Budget | Modality split (S/B/R + strength) | Intensity dist. (Z1/Z2/Z3) | ~Weekly load | Anchor sessions | Optimizes / Sacrifices | Realistic level |
|---|---|---|---|---|---|---|
| **5 h** | S 18% / B 45% / R 30% / strength 7% | 50 / 25 / 25 | ~1,700 | 2 threshold/sweet-spot bricks; 1 hard swim; 1 longest-possible ride; minimal long run | Optimizes threshold, VO₂max, finishing fitness / Sacrifices durability, fat oxidation, fueling practice, run robustness | Survival-only; back-of-pack finisher |
| **10 h** | S 20% / B 47% / R 28% / strength 5% | 68 / 17 / 15 | ~2,900 | Weekly long ride (2.5–3 h) + long run (75–90 min); 2 quality; 2–3 swims | Optimizes credible mid-pack 70.3 / Sacrifices late-race durability depth | Competitive age-grouper |
| **20 h** | S 22% / B 48% / R 25% / strength 5% | 80 / 8 / 12 | ~5,300 | Big Z1 base; long brick; race-nutrition rehearsal; 2 quality | Optimizes durability, fat oxidation, GI tolerance, competitive readiness / Sacrifices little | Kona-70.3-qualifier / elite |
| **30 h** | S 22% / B 50% / R 23% / strength 5% | 85 / 5 / 10 | ~7,400 | Polarized; very large aerobic base; durability-focused long sessions | Optimizes elite durability and metabolic depth / Approaching diminishing returns | Elite / Pro |
| **40 h** | S 20% / B 52% / R 23% / strength 5% | 88 / 4 / 8 | ~9,200 | Pro base/camp loading | Marginal returns over 30 h; recovery-support-dependent | Pro only |

---

### 6.7 Ironman (140.6)

Ironman (~8–17 hours) is the report's clearest case of volume-dominance. Performance correlates with accumulated Zone 1 volume at r ≈ −0.9 (Muñoz 2014); the race is won on fat oxidation, durability, GI tolerance, and structural resilience — all volume-gated and none substitutable by intensity. Low budgets deliver *finishing*, not *competing*, and the gap widens with every hour of the race.

| Budget | Modality split (S/B/R + strength) | Intensity dist. (Z1/Z2/Z3) | ~Weekly load | Anchor sessions | Optimizes / Sacrifices | Realistic level |
|---|---|---|---|---|---|---|
| **5 h** | S 15% / B 50% / R 30% / strength 5% | 45 / 25 / 30 | ~1,750 | 2 hard bricks; 1 longest-possible ride; intensity-dense by necessity | Optimizes central fitness only / Sacrifices nearly all durability, fat oxidation, fueling, structural prep — high back-half blow-up and injury risk | Not advised except experienced athletes seeking to finish |
| **10 h** | S 18% / B 52% / R 25% / strength 5% | 65 / 18 / 17 | ~2,900 | Weekly long ride (3–4 h) + long run (90–120 min); cycling-fitness crossover; sparse quality | Optimizes a realistic finish (sub-elite executions exist) / Sacrifices durability depth, GI robustness, injury margin | Determined age-grouper; execution-dependent |
| **20 h** | S 20% / B 52% / R 23% / strength 5% | 80 / 8 / 12 | ~5,300 | Very large Z1 base; long brick with race-nutrition; back-to-back long days | Optimizes durability, fat oxidation, GI tolerance — genuine competitiveness / Sacrifices little; near the amateur optimum | Kona-qualifier / strong age-grouper |
| **30 h** | S 20% / B 53% / R 22% / strength 5% | 85 / 5 / 10 | ~7,400 | Professional polarized base; 5–7 h rides; durability the explicit target | Optimizes maximal durability and metabolic depth for 8+ h racing / Overtraining risk real; full-time recovery required | Pro / full-time athlete |
| **40 h** | S 20% / B 54% / R 21% / strength 5% | 88 / 4 / 8 | ~9,600 | Camp-block loading; monitored for non-functional overreaching | Optimizes the volume-gated ceiling for the longest events / Net-negative without pro recovery infrastructure; camp-only | Pro peak-block only |

Ironman guardrail: this is the event where the engine must most firmly resist the athlete's instinct to "make up" for low volume with intensity. Muñoz's finding that *more Zone 2 correlates with slower racing* means the low-budget Ironman athlete should still keep the majority of their limited hours genuinely easy and accept a durability deficit, rather than converting the week into gray-zone work that raises cost without buying the traits the race demands.


---

## Part VII — Engine Integration: Operationalizing the Framework in Duravel

This section translates the report into implementable logic. It is written so the programming engine can consume it directly.

### 7.1 Adopt a single internal load metric

Standardize on **session-RPE load** (RPE 0–10 × duration in minutes) as the primary internal-load currency, because it is valid across every modality Duravel programs — run, bike, swim, barbell, and station work — where heart-rate or power models fail or are unavailable. Layer heart-rate TRIMP or TSS on top *where the data exist* (structured bike/run sessions with power or HR), but never require them. Store per-session load and maintain two rolling aggregates per the fitness-fatigue model: a ~42-day exponentially weighted "chronic load" (fitness proxy) and a ~7-day "acute load" (fatigue proxy), exposing their difference as "form."

### 7.2 Represent substitution as outcome-specific, not scalar

The engine should model at least three adaptation "buckets," each with its own dose-response to volume vs. intensity, rather than a single fitness number:

- **Central/aerobic power (VO₂max, mitochondrial signaling):** responds efficiently to intensity; maintainable on low volume if intensity is preserved. High substitutability.
- **Peripheral/base (capillarization, fat oxidation, LT1, plasma volume, economy):** responds to accumulated Z1 volume and frequency; reverses when volume is withdrawn. Low substitutability.
- **Durability & structural (fatigue resistance, tendon/bone robustness):** responds only to accumulated time and progressive loading cycles; slowest to build, most volume-gated.

A time-crunched plan should be flagged in the UI for *which buckets it under-serves* given the target event — this is the "informed trade" the report argues for.

### 7.3 Scale intensity distribution to volume automatically

Encode the Section 3.3 schedule as a function of weekly hours and phase:

- Compute a target Z3 *quantity* (not percentage) from recovery capacity — default 2–3 quality sessions/week, adjustable by training age, age, and HRV/readiness where available. Hold this roughly constant as volume changes.
- Fill the remainder with Z1, letting the Z1 *percentage* rise automatically as total volume rises. This reproduces the pyramidal-at-low-volume → polarized-at-high-volume migration without a separate rule.
- Minimize Z2 ("gray zone") near competition and for long-course athletes specifically (Muñoz: more Z2 → slower Ironman); allow more Z2 in base phases and at the lowest budgets where stimulus density is required.
- Apply a **pyramidal-base → polarized-sharpen** periodization across the macrocycle.

### 7.4 Protect intensity when time collapses

When an athlete's available time drops week-to-week, the engine should **cut volume and preserve the quality sessions** (Hickson; taper literature), never the reverse. A maintenance week should retain 1–2 intensity sessions and shed easy volume. Communicate that this holds VO₂max/threshold for ~2–4 months but erodes base/durability beyond that.

### 7.5 Guardrails

- **Load-progression guardrail:** flag weekly load increases that would push an uncoupled acute:chronic ratio above ~1.3–1.5, and single-session jumps beyond ~30% of the prior 30-day maximum for that modality (Nielsen) — with the strongest weighting on running impact.
- **Monotony/strain guardrail:** compute Foster monotony and strain weekly; flag low-variability, high-strain weeks (all-intensity or same-every-day patterns) as overtraining/illness risk.
- **Concurrent-training guardrail:** cap high-volume hypertrophy work for endurance-priority athletes; keep strength/power low-volume and high-quality; separate hard strength and hard endurance by hours/days; sequence quality-first. Weight the interference penalty toward *power* output, not maximal strength.
- **Impact/structural guardrail:** for HYROX and running-heavy plans above ~20 h, route incremental aerobic volume to low-impact modalities (SkiErg, row, bike) to respect the slow adaptation of connective tissue.
- **Event-duration weighting:** scale the "volume deficit" warning by target-event duration — a 5-hour DEKA plan is complete; a 5-hour Ironman plan should carry an explicit durability/finishing-risk flag.

### 7.6 A worked example of the substitution logic

An athlete targeting HYROX drops from 10 to 5 available hours. The engine should: (1) hold the two quality sessions (1 VO₂, 1 threshold+station); (2) keep one heavy-strength session for the power floor; (3) cut long-run and easy-aerobic volume; (4) raise the Z3 share from ~15% to ~20% so stimulus density is preserved; (5) surface a message: "This plan maintains your aerobic power and station efficiency but will slowly reduce your race durability (compromised-running resistance). Expected to hold for ~8–12 weeks." That message is the report's thesis rendered as product.

---

## Part VIII — Limitations and Evidence Gaps

Intellectual honesty requires naming where this framework rests on thin or contested evidence:

- **HYROX physiology rests on a single small study** (Brandt 2025, N=11 recreational athletes). The VO₂max-dominance finding is plausible and coheres with the event's structure, but it has not been replicated in elite cohorts, and per-split "compromised running" figures are largely coaching data.
- **No laboratory study of DEKA exists.** The DEKA profiles are inferred from format and duration and should be treated as reasoned hypotheses, not measured facts.
- **The polarized-training advantage is real but narrow and confounded.** The strongest trials (Stöggl, Neal) did not fully volume-match their arms, and the cleanest meta-analysis finds polarization superior only for VO₂peak, not race performance. The report treats intensity distribution as a fine-tuning lever accordingly.
- **The ACWR injury framework is methodologically contested** (Lolli, Impellizzeri). It is used here only as a soft guardrail, not a causal target.
- **The low-volume HIIT literature is dominated by untrained subjects over short timeframes.** Its dramatic substitution findings should not be over-generalized to trained athletes or long events — the central caution of Part II.
- **Durability is an active research frontier.** Its definition is established (Maunder 2021), but the quantitative volume→durability dose-response has not been mapped; the claim that durability is volume-built is a well-supported inference, not a settled dose-response.
- **The load-equivalence numbers are illustrative.** The weekly session-RPE load bands in Part VI are modeled from representative RPE anchors, not measured cohort data; they are intended to convey *proportions and ceilings*, not precise targets.
- **Several primary sources were access-limited during research** and were verified through reputable secondary summaries; exact effect sizes for a handful of classic studies (Hickson's precise percentages, Wilson 2012 interference effect sizes, some meta-analytic pooled estimates) should be confirmed against primary texts before being used as hard engine parameters.

None of these gaps overturns the report's structure. The core claims — that load is non-linearly weighted and outcome-specific, that intensity substitutes for volume for fast-adapting central traits but not for volume-gated peripheral and durability traits, and that the trade's severity scales with event duration and training age — are each supported by multiple independent lines of evidence.

---

## References

*Grouped by theme. Confidence and access notes from the research phase are retained where relevant.*

**Load quantification and modeling**
- Banister EW (1991). Modeling elite athletic performance. In *Physiological Testing of Elite Athletes*. Human Kinetics.
- Morton RH, Fitz-Clarke JR, Banister EW (1990). Modeling human performance in running. *J Appl Physiol* 69:1171–1177.
- Foster C (1998). Monitoring training in athletes with reference to overtraining syndrome. *Med Sci Sports Exerc* 30(7):1164–1168.
- Foster C et al. (2001). A new approach to monitoring exercise training. *J Strength Cond Res* 15(1):109–115.
- Lucia A et al. (2003). Tour de France versus Vuelta a España: which is harder? *Med Sci Sports Exerc* 35(5):872–878.
- Edwards S (1993). *The Heart Rate Monitor Book*. Polar Electro.
- Allen H, Coggan A (2010). *Training and Racing with a Power Meter*. VeloPress.
- Skiba PF (2006). Calculation of power output and quantification of training stress in distance runners (GOVSS).
- Calvert TW, Banister EW, Savage MV, Bach T (1976). A systems model of the effects of training on physical performance. *IEEE Trans Syst Man Cybern*.
- Hellard P et al. (2006). Assessing the limitations of the Banister model. *J Sports Sci* 24(5):509–520.

**Acute:chronic workload and injury**
- Gabbett TJ (2016). The training-injury prevention paradox. *Br J Sports Med* 50(5):273–280.
- Hulin BT et al. (2016). *Br J Sports Med* 50:231–236.
- Lolli L et al. (2019). Mathematical coupling causes spurious correlation within the ACWR. *Br J Sports Med* 53(15):921–922.
- Impellizzeri FM et al. (2020). ACWR: conceptual issues and fundamental pitfalls. *Int J Sports Physiol Perform* 15(6):907–913.
- Nielsen RØ et al. (2014). *J Orthop Sports Phys Ther* 44(10):739–747.
- Nielsen RØ et al. (2024). Prospective running-injury cohort. *Br J Sports Med*.
- Malisoux L et al. (2020). Shoe cushioning and injury risk (RCT). *Am J Sports Med* 48(2):473–480.

**Low-volume HIIT and dose-response**
- Burgomaster KA et al. (2005). *J Appl Physiol* 98:1985–1990.
- Gibala MJ et al. (2006). *J Physiol* 575:901–911.
- Burgomaster KA et al. (2008). *J Physiol* 586(1):151–160.
- Gillen JB, Gibala MJ et al. (2016). Twelve weeks of SIT vs MICT. *PLoS ONE* 11(4):e0154075.
- MacInnis MJ et al. (2017). Superior mitochondrial adaptations after interval vs continuous single-leg cycling matched for work. *J Physiol* 595(9):2955–2968.
- MacInnis MJ, Gibala MJ (2017). Physiological adaptations to interval training and the role of exercise intensity. *J Physiol* 595(9):2915–2930.
- Metcalfe RS et al. (2012). Towards the minimal amount of exercise for improving metabolic health. *Eur J Appl Physiol* 112:2767–2775.
- Gunnarsson TP, Bangsbo J (2012). The 10-20-30 training concept. *J Appl Physiol* 113:16–24.
- Mølmen KS, Almquist NW, Skattebo Ø (2025). Volume vs intensity systematic review and meta-regression. *Sports Medicine* 55:115–144.
- Granata C, Bishop DJ et al. (2016). Mitochondrial adaptations reversed after reduced training volume. *FASEB J* 30(10):3413–3423.

**Intensity distribution**
- Seiler S, Kjerland GØ (2006). *Scand J Med Sci Sports* 16:49–56.
- Fiskerstrand Å, Seiler S (2004). *Scand J Med Sci Sports* 14:303–310.
- Seiler S (2010). What is best practice for training intensity and duration distribution? *Int J Sports Physiol Perform* 5(3):276–291.
- Stöggl T, Sperlich B (2014). *Frontiers in Physiology* 5:33.
- Neal CM et al. (2013). *J Appl Physiol* 114:461–471.
- Muñoz I et al. (2014). Does polarized training improve performance in recreational runners? *Int J Sports Physiol Perform* 9:265–272.
- Rosenblat MA, Sethna A, Lyons JL (2019). *J Strength Cond Res* 33:3491–3500.
- Silva Oliveira R, Boppre G, Fonseca H (2024). Polarized vs other TIDs. *Sports Medicine* 54(8):2071–2095.

**Reduced training / maintenance / taper**
- Hickson RC, Rosenkoetter MA (1981). *Med Sci Sports Exerc* 13:13–16.
- Hickson RC et al. (1982). *J Appl Physiol* 53:225–229.
- Hickson RC et al. (1985). *J Appl Physiol* 58:492–499.
- Houmard JA et al. (1990). Reduced training maintains performance in distance runners. *Int J Sports Med*.
- Bosquet L et al. (2007). Effects of tapering on performance: a meta-analysis. *Med Sci Sports Exerc* 39(8):1358–1365.

**Volume-gated adaptations and durability**
- Holloszy JO (1967). *J Biol Chem* 242:2278–2282.
- Kjaer M, Magnusson SP et al. (2009). Tendon adaptation to loading. *Scand J Med Sci Sports*.
- Arbab-Zadeh A et al. (2014). Cardiac remodeling in response to 1 year of endurance training. *Circulation* 130.
- Convertino VA (1991). Blood volume: adaptation to endurance training. *Med Sci Sports Exerc* 23(12):1338–1348.
- Maunder E, Plews DJ, Kilding AE (2018). Maximal fat oxidation determinants. *Frontiers in Physiology* 9:599.
- Maunder E, Seiler S, Mildenhall MJ, Kilding AE, Plews DJ (2021). Durability. *Sports Medicine* 51(8):1619–1628.
- Hunter B et al. (2025). Durability methodological review. *Experimental Physiology* 110(11).
- Matomäki P et al. (2023). Durability improved by LIT and HIT. *Frontiers in Physiology* 14.
- Plews DJ, Laursen PB, Stanley J, Kilding AE, Buchheit M (2013). HRV in elite endurance athletes. *Sports Medicine* 43(9):773–781.
- Nieman DC et al. (1990). LA Marathon URTI study. *J Sports Med Phys Fitness* 30(3):316–328.
- Cadegiani FA, Kater CE (2017). Hormonal aspects of overtraining. *BMC Sports Sci Med Rehabil*.

**HYROX / DEKA / CrossFit / concurrent training**
- Brandt T, Ebel C, Lebahn C, Schmidt A (2025). Acute physiological responses and performance determinants in Hyrox. *Frontiers in Physiology* 16:1519240.
- Claudino JG et al. (2018). CrossFit overview: systematic review and meta-analysis. *Sports Medicine-Open* 4(1).
- Hickson RC (1980). Interference of strength development by simultaneously training for strength and endurance. *Eur J Appl Physiol* 45:255–263.
- Wilson JM et al. (2012). Concurrent training: a meta-analysis. *J Strength Cond Res* 26(8):2293–2307.
- Coffey VG, Hawley JA (2017). Concurrent exercise training: do opposites distract? *J Physiol* 595(9):2883–2896.
- Fyfe JJ, Bishop DJ, Stepto NK (2014). Interference between concurrent resistance and endurance exercise. *Sports Medicine* 44:743–762.
- Schumann M, Rønnestad BR (2019). *Concurrent Aerobic and Strength Training*. Springer.
- Zanini M, Folland JP, Wu H, Blagrove RC (2025). Strength training and durability of running economy. *Med Sci Sports Exerc* (ahead of print).

**Triathlon / long-course volume**
- Cejuela R, Sellés-Pérez S (2022). World-class Olympic triathlete case study. *Frontiers in Physiology* 13:835705.
- Muñoz I, Cejuela R, Seiler S, Larumbe E, Esteve-Lanao J (2014). Training-intensity distribution and Ironman performance. *Int J Sports Physiol Perform* 9(2):332–339.
- Sellés-Pérez S, Fernández-Sáez J, Cejuela R (2019). Polarized vs pyramidal in half-Ironman. *J Sports Sci Med* 18:708–715.
- Friel J. *The Triathlete's Training Bible* (annual-hours planning framework).
- Jeukendrup AE. Training the gut for athletes. GSSI Sports Science Exchange #178.
