# Duravel — Technique Video Library
### Design & Build Spec (Preparatory — Future Phase)

**Author:** Product + Eng (prep doc for Levi)
**Date:** 2026-07-15
**Status:** Design-ready, not yet scheduled. Research + design only.
**Repo target:** `C:\dev\duravel` · migrations continue from **0019**

> **How this document was hardened.** This is the implementation-ready successor to the first draft. The material changes from that draft, all folded into the sections below:
> 1. **Resolution assumption corrected.** The first draft assumed prescribed exercise labels are a closed, deterministically-emitted set that a render-time resolver can map to slugs. In reality **Haiku fills session content**, so exercise labels are partly free-text. Movement-slug emission is therefore promoted from "optional later" to a **near-term hardening step**, and the render-time resolver is redesigned around an explicit normalization pipeline plus unresolved-label telemetry (§3, §5).
> 2. **SEO ↔ signed-playback contradiction resolved.** Signed playback IDs and short-lived tokens make `VideoObject` JSON-LD `contentUrl` and public grid posters break for crawlers. Fixed with a **dual playback-ID model** (one public, low-value SEO/poster ID; one signed, full-quality gated ID) per asset (§3, §4, §7).
> 3. **Webhook idempotency added.** `video.asset.ready` can fire more than once; added a unique constraint on the provider asset id and upsert semantics (§3, §4).
> 4. **Operational gaps closed.** `updated_at` triggers, playback-token rate limiting, admin-gating placement (server action + layout, not just middleware), trademark/nominative-use note, and a graceful "video coming soon" state for seeded-but-unfilmed movements (§4, §6, §9).
> 5. **Effort re-scoped.** Engineering held at **M**, but the honest **overall estimate is M–L** once content production and the resolver/telemetry work are counted (§10).

---

## 1. Goal & Why Now

**Goal.** Give every prescribed session a one-tap path to a short, high-quality technique demo for the movement it asks the athlete to perform — starting with the 8 HYROX stations and the strength movements the engine programs — so athletes execute the plan *correctly*, not just consistently.

**Why this, why now:**

1. **The plan is already granular; execution is the weak link.** The engine prescribes exact stations, loads, paces, and strength movements. A user reading "6× sandbag lunges 20m @ RPE 7" or "sled push 4×25m" has no in-app answer to *"am I doing this right?"* Today they leave Duravel for YouTube — a retention leak at the moment of highest intent (mid-workout, phone in hand).
2. **Technique is a real HYROX performance lever, not a nicety.** Station inefficiency (wall-ball depth/rebound timing, sled-push body angle and stride, sled-pull hand-over-hand vs. sit-back) costs minutes over a race. Coaching content directly supports the core promise (get faster) and an *engine assumption* the adaptation math depends on: that prescribed work is executed as intended. Bad technique is a hidden confound in RPE/underperformance signals.
3. **Cheap at current scale, compounding as an asset.** At an MVP library of ~50–60 short clips, delivery sits inside a video CDN's low/free tier — effectively $0–$5/mo (§7). The content, once shot, is durable and reusable across HYROX *and* the planned triathlon/Ironman expansion (swim drills, brick transitions, bike handling).
4. **Low-risk, high-visibility for a solo founder, and a funnel.** No engine changes are required to link videos to sessions (a taxonomy lookup, not schema coupling). The public library index is an **SEO/top-of-funnel acquisition surface** while `BILLING_ENABLED` continues to gate generation and the weekly-review Apply.
5. **Sport-agnostic by design.** A *movement* taxonomy generalizes cleanly beyond HYROX, matching the "Duravel" brand's diversification bet.

**Non-goals (this phase):** user-generated video; form-checking / CV analysis of user uploads; live coaching; downloadable offline video; native-app video (blocked on the LLC/Apple prerequisite regardless — this ships web-first). Captions/transcripts and search/filter are explicitly deferred (schema is provisioned for them now; UI is later).

---

## 2. User-Facing Scope

### MVP (ship first)

- **Movement library index** — `/library`, browsable, grouped by category (HYROX Stations, Lifts, Accessory/Core, Run Drills). Public and crawlable for SEO.
- **Movement detail page** — `/library/[slug]`: primary demo video, 3–6 bullet coaching cues, common mistakes, HYROX standards/rep-rules where relevant, equipment/loads.
- **Inline linking from the program view** — every prescribed exercise/station renders a compact "Watch technique" affordance that opens the movement's demo in a drawer/modal (no navigation away from the workout).
- **The 8 HYROX stations + the ~15–25 most-prescribed strength movements** (§8). One clean demo per movement, 30–75 s, portrait (9:16).
- **Poster/thumbnail images** for fast, cheap grid rendering (no autoplay of full video in lists).
- **Graceful "demo coming soon" state** for movements whose metadata is seeded but whose video is not yet filmed/ready (Phase B seeds rows before Phase D shoots them).

### Later (post-MVP)

- **Variations & regressions/progressions** per movement (wall ball → box-assisted; sled push high/low handle).
- **Fault-specific micro-clips** ("fixing early arm pull on ski erg") surfaced by adaptation signals (high RPE/underperformance on a station → suggest the fix clip in the weekly review, read-only).
- **Chaptered long-form** station-strategy videos (pacing, transitions, roxzone management).
- **Search & filter** (equipment, muscle group, station).
- **Captions (WebVTT) + transcripts** (accessibility + SEO).
- **Triathlon/Ironman expansion set** reusing the same taxonomy and schema.
- **"Coach's note" personalization** — Haiku composes a 1–2 sentence contextual tip tying a generic cue to *this* athlete's prescribed load/pace (§5).

---

## 3. Data Model / Schema Changes

**Design principles:** (a) the **engine stays decoupled** — videos link to a *movement taxonomy*, and prescribed exercises resolve to a movement via a stable `slug`, so no engine/generation schema change is required for MVP; (b) the Supabase client is **untyped**, so queries cast `as` — keep column names explicit and stable, and never rely on generated types; (c) **RLS on every new table**, with the service-role admin client as the sole writer (no write policies for `anon`/`authenticated`, mirroring the Stripe-webhook-as-sole-writer pattern); (d) provision now for things we defer (captions, dual playback IDs) so we don't need a migration to turn them on.

### Migration `0019_movements.sql` — canonical movement taxonomy

```sql
create table public.movements (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique,            -- 'wall-balls','sled-push','back-squat'
  name             text not null,                   -- 'Wall Balls'
  category         text not null,                   -- 'hyrox_station'|'lift'|'accessory'|'run_drill'|'mobility'
  is_hyrox_station boolean not null default false,
  station_order    int,                             -- 1..8 for stations, else null
  summary          text,                            -- short description for index cards
  cues             jsonb not null default '[]'::jsonb,   -- ["Full squat depth","Drive through heels"]
  common_faults    jsonb not null default '[]'::jsonb,   -- ["Short-arming the throw"]
  standards        jsonb,                           -- HYROX rep rules / loads keyed by division
  equipment        text[] not null default '{}',    -- ['wall-ball','target-10ft']
  aliases          text[] not null default '{}',    -- resolver aid: ['wallball','wall ball','WB']
  primary_video_id uuid,                            -- FK added in 0020 (after videos exists)
  status           text not null default 'draft',   -- 'draft'|'published' (controls public visibility)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint movements_category_chk
    check (category in ('hyrox_station','lift','accessory','run_drill','mobility')),
  constraint movements_station_order_chk
    check (station_order is null or (station_order between 1 and 8))
);

create index movements_category_idx on public.movements (category);
create unique index movements_station_order_uidx
  on public.movements (station_order) where station_order is not null;

alter table public.movements enable row level security;

-- Read: authenticated users always; anon only for published rows (public SEO funnel).
create policy movements_read_authenticated
  on public.movements for select to authenticated using (true);
create policy movements_read_anon_published
  on public.movements for select to anon using (status = 'published');
-- Writes: service-role only (no insert/update/delete policies defined).
```

> **Gating note.** The `anon` read policy is scoped to `status = 'published'` so half-authored drafts never leak to crawlers. Even with public *metadata*, video **playback** stays gated by the signed playback ID (§7). See the dual-playback-ID model below for how SEO and gating coexist.

### Migration `0020_videos.sql` — media assets

```sql
create table public.videos (
  id                    uuid primary key default gen_random_uuid(),
  provider              text not null default 'mux',   -- 'mux'|'youtube'|'vimeo'|'self'
  provider_asset_id     text,                          -- Mux asset id
  signed_playback_id    text,                          -- gated, full-quality (in-app playback)
  public_playback_id    text,                          -- low-value poster/preview for SEO (optional per video)
  status                text not null default 'preparing', -- 'preparing'|'ready'|'errored'
  duration_sec          numeric,
  aspect_ratio          text,                          -- '9:16','1:1','16:9'
  poster_url            text,                          -- derived from public_playback_id when present
  captions_url          text,                          -- WebVTT (provisioned; populated later)
  title                 text not null,
  attribution           text,                          -- if licensed/3rd-party
  error_detail          text,                          -- provider error payload when status='errored'
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- idempotency: the Mux webhook may deliver asset.ready more than once.
  constraint videos_provider_asset_uniq unique (provider, provider_asset_id)
);

alter table public.videos enable row level security;
create policy videos_read_authenticated
  on public.videos for select to authenticated using (true);
create policy videos_read_anon
  on public.videos for select to anon using (true);   -- rows are non-sensitive metadata only
-- Writes: service-role only.

alter table public.movements
  add constraint movements_primary_video_fk
  foreign key (primary_video_id) references public.videos(id) on delete set null;
```

**Dual playback-ID rationale (the SEO/gating fix).** Mux allows **multiple playback IDs per asset**, each with its own policy. We attach two: a **signed** ID (full quality, used only through the in-app player after a JWT is minted server-side) and an optional **public** ID used solely for the poster image and a short muted SEO preview on the public detail page. This lets crawlers and logged-out visitors see a real `VideoObject` with a resolvable `thumbnailUrl`/`contentUrl` while the high-value in-app experience stays token-gated. A movement can ship with signed-only (no public ID) if we decide a given demo should not be publicly viewable at all.

### Migration `0021_movement_videos.sql` — movement ↔ video (many demos per movement)

```sql
create table public.movement_videos (
  id          uuid primary key default gen_random_uuid(),
  movement_id uuid not null references public.movements(id) on delete cascade,
  video_id    uuid not null references public.videos(id) on delete cascade,
  role        text not null default 'demo',   -- 'demo'|'variation'|'fault_fix'|'strategy'
  label       text,                           -- 'Box-assisted regression'
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  unique (movement_id, video_id),
  constraint movement_videos_role_chk
    check (role in ('demo','variation','fault_fix','strategy'))
);

alter table public.movement_videos enable row level security;
create policy movement_videos_read_authenticated
  on public.movement_videos for select to authenticated using (true);
create policy movement_videos_read_anon
  on public.movement_videos for select to anon using (true);
```

### `updated_at` triggers (all three tables)

The `default now()` only sets the value on insert. Add a shared trigger so `updated_at` reflects edits (admin re-authoring cues, webhook status flips):

```sql
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger movements_set_updated_at before update on public.movements
  for each row execute function public.set_updated_at();
create trigger videos_set_updated_at    before update on public.videos
  for each row execute function public.set_updated_at();
```
> If the repo already defines an equivalent `set_updated_at()` (check migrations 0001–0018 for a `moddatetime`/trigger convention before 0019), reuse it instead of redefining to avoid a name clash.

### Linking prescribed sessions → movements

The engine skeleton is deterministic, but **generation fills sessions via Haiku**, so the *exercise label an athlete sees is not guaranteed to be a fixed enum string*. This is the single most important correction to the original plan. We use a **two-layer link** — a persisted key written at generation time (authoritative) with a render-time resolver as fallback:

1. **Authoritative — persist `movement_slug` at generation time (near-term, recommended for GA).** The programs/session content is stored as `jsonb` (on `programs`, per the data model). During generation, after the deterministic engine chooses the movement and Haiku phrases the session, write a `movement_slug` field into each exercise object, chosen from a **closed enum of existing `movements.slug` values injected into the Haiku prompt** and **Zod-validated against that enum** (§5). Because it's a JSON field, **no migration is required** — it's an additive property on existing `jsonb`. Old programs simply lack the field and fall through to the resolver.
2. **Fallback — render-time resolver `lib/library/resolveMovement.ts` (pure, vitest-tested).** For any exercise lacking a persisted `movement_slug` (legacy programs, enum misses), resolve the displayed label to a slug at render time. This is **not** a naive name match; it is a normalization pipeline:
   - lowercase; strip loads/units (`kg`, `lb`, `m`, `%`), rep/set schemes (`6×`, `4x25`, `AMRAP`, `EMOM`), tempo prefixes (`3s eccentric`), and RPE/zone suffixes;
   - collapse whitespace/punctuation; map through `movements.slug`, `movements.name`, and `movements.aliases`;
   - return `null` on no confident match (do **not** render a broken button).
   - Unit tests cover the 8 station labels, the top ~25 lift labels, and a fixture of representative Haiku phrasings (with/without loads, plural/singular, common abbreviations). **Log every `null` resolution in production** (structured log with the raw label) so the alias table and enum can be tuned. This telemetry is the early-warning system for label drift.

**Why a taxonomy, not a `video_id` on sessions.** Movements are stable and few (~30 for MVP); sessions are numerous and **regenerated on adaptation**. Coupling videos to the durable taxonomy means re-generating a program never breaks a link, and one video edit propagates everywhere. A hard per-session `video_id` would be invalidated on every weekly Apply.

**Explicitly deferred:** a dedicated `0022` column linking sessions to movements in a relational table. The `jsonb` `movement_slug` field covers the need without schema change; only introduce a real column if session-exercise storage is later normalized out of `jsonb`.

---

## 4. API / Route & Server-Action Changes

Next.js 16 App Router — server components for reads, server actions for privileged writes, route handlers for the signed-token endpoint and provider webhook.

**Public reads (server components, cached):**
- `app/library/page.tsx` — index. Reads published `movements` (+ primary video poster). Statically generated / ISR-revalidated; no per-user data.
- `app/library/[slug]/page.tsx` — detail. Reads movement + `movement_videos`. `generateStaticParams()` from published `movements.slug`; `generateMetadata()` for SEO (title, description, and `VideoObject` JSON-LD whose `thumbnailUrl` uses the **public** playback ID's image and whose `contentUrl`/`embedUrl` uses the public preview — never a signed URL, which would expire and break the crawl).
- Both pages render the "demo coming soon" state when the movement is published but has no `ready` video.

**Playback token (route handler, the single authorization choke point):**
- `app/api/library/playback-token/route.ts` (`GET`, auth-required). Input `videoId`. Verifies the caller's Supabase session server-side, then returns a **short-lived Mux signed JWT** for the video's `signed_playback_id`, scoped by audience (`v` playback, `t` thumbnail, `s` storyboard) and TTL ~1–2 h. Signing key read from server-only env (`MUX_SIGNING_KEY_ID`, `MUX_SIGNING_PRIVATE_KEY`). **Rate-limit** this route (per-user, e.g. token-bucket in memory/Upstash) so a leaked session can't farm tokens at scale. Returns 401 for unauthenticated callers; the public detail page never calls it (it uses the public preview).

**Program-view integration (existing session/program route):**
- The session renderer resolves each exercise via the persisted `movement_slug` (preferred) or `resolveMovement(label)` (fallback). On a hit it renders a compact **"Watch technique"** button that opens a client drawer; the drawer fetches a playback token *on open* and disposes the player on close. No new write path in the workout flow. On a `null` resolution it renders nothing (no broken affordance).

**Admin ingest (server actions, service-role):** `lib/library/adminActions.ts`
- `createMovement(input)` — **Zod**-validated; inserts via service-role admin client (cast `as`).
- `attachVideoFromMux(movementId, muxAssetId, role)` — creates/updates the `videos` row from a Mux asset and links it via `movement_videos`.
- Both are `'use server'` actions. **Authorization is enforced inside the action** (admin allowlist check against Levi's user id/email) — not solely in middleware, because middleware on the edge can't reliably do DB/identity checks and a server action is directly invocable. Layer defense: allowlist check in the action **and** an admin check in the `/admin/library` layout, with `middleware.ts` doing only a coarse redirect of unauthenticated users.

**Provider webhook (route handler, sole writer of video readiness):**
- `app/api/webhooks/mux/route.ts` (`POST`). **Verifies the Mux webhook signature** (`MUX_WEBHOOK_SECRET`, HMAC via the Mux Node SDK's header verification) before doing anything. On `video.asset.ready`, **upserts** by `(provider, provider_asset_id)` — the unique constraint makes redelivery idempotent — setting `status='ready'`, `duration_sec`, `aspect_ratio`, `signed_playback_id`, and (if configured) `public_playback_id`/`poster_url`. On `video.asset.errored`, set `status='errored'` + `error_detail`. Mirrors the Stripe pattern: **the Mux webhook is the sole writer of video readiness state.**

**No changes to:** Stripe billing, entitlement, the generation core's engine skeleton, or adaptation math. `BILLING_ENABLED` is untouched. The public library is a lighter-gated surface by decision (§9); the in-workout affordance is only seen inside the (paid/trial) program view anyway.

---

## 5. Engine / AI Implications

**Deterministic engine — no changes.** It keeps owning structure, volume, zones, paces, station pacing, and strength selection. It emits the movement; the library resolves it at the presentation layer. Clean separation preserved: engine owns *what/how much*; library owns *how to execute*.

**Haiku (session content generation) — one near-term change, one later change:**

1. **Movement-slug emission (near-term, recommended before GA).** Because Haiku phrases sessions, the robust link is to have generation also emit a `movement_slug` per exercise, chosen from a **closed enum of existing `movements.slug` values injected server-side into the prompt**, and **Zod-validated against that enum**. On a validation miss, fall back to the deterministic `resolveMovement` resolver, and log the miss. This keeps the deterministic engine the source of truth for *which* movements exist (the model can label, but cannot invent taxonomy), and it de-risks the whole feature from label drift. It is additive to an existing Zod-validated generation path, so cost/complexity is low.
2. **"Coach's note" personalization (later).** A short Haiku call composes 1–2 sentences tying a movement's generic cues to the athlete's prescribed dose ("At your prescribed 6 kg wall ball and RPE 7, prioritize a consistent rebound over speed"). **Cache per `(movement, prescription-bucket)`** to bound token spend; Zod-validate length/format; it may reference engine numbers but must **never override** them.

**Adaptation tie-in (later, read-only).** Existing signals (session RPE, station underperformance vs. plan) can surface a **fault-fix clip** in the weekly review — a *content* recommendation, not a program change. It reads adaptation outputs; it does **not** feed back into ACWR/monotony/readiness math. (Note the reverse benefit: better technique reduces noise in exactly these signals, improving adaptation quality.)

---

## 6. UX Outline

**Library index (`/library`):** sectioned grid — "HYROX Stations" (8, ordered 1–8), "Strength Lifts", "Accessory & Core", "Run Drills". Each card: poster thumbnail (from public playback ID), movement name, station badge, duration. Lazy-loaded posters; **no autoplay in grid**. Cards for movements without a ready video show a subtle "Demo coming soon" ribbon and still link to the detail page (metadata + cues have standalone value and SEO weight).

**Movement detail (`/library/[slug]`):** hero player (Mux Player web component; in-app uses the signed playback ID + fetched token; the public page uses the public preview). Coaching **cues** (bulleted), **common faults** (visually distinct), **HYROX standard** callout (loads by division, rep rules) where `is_hyrox_station`. Variations/regressions row (later). "Where this appears in your plan" deep link (nice-to-have).

**In-program integration:** beside each prescribed exercise/station, a compact **"Watch technique"** play glyph. Tapping opens a **bottom drawer/modal** with the demo — the athlete never loses their place. Player fetches a signed token on open, disposes on close. First-time subtle hint: "New: technique demos."

**Admin (`/admin/library`, Levi-only):** table of movements + attach-video flow (paste Mux asset id → poll/await webhook status → link). Minimal, not user-facing. For the first ~30 clips, a seed **script** may beat building this UI (§9).

**Accessibility:** on-screen text cues in v1 (no VO); captions (WebVTT) later; keyboard-operable player; `prefers-reduced-motion` respected (no autoplay); poster `alt` from movement name; "coming soon" state is text, not an empty player.

---

## 7. Third-Party Services + Rough Costs

> Pricing below reflects publicly documented tiers as of early–mid 2026; **re-verify current numbers at build time** before committing spend. Figures are directional, not contractual.

### Recommendation: **Mux Video** for MVP (Cloudflare Stream as the credible fallback)

| Option | Encode | Storage | Delivery | Access control | Fit |
|---|---|---|---|---|---|
| **Mux Video** | Basic tier: free input | ~$0.0024/min/mo (720p basic) | First ~100k delivered min/mo free, then ~$0.0008–$0.0032/min | **Signed playback IDs + JWT**, native; **multiple playback IDs/asset** (enables the public+signed split) | **Best** — dev-first API, Node SDK, Next.js examples, per-video signed tokens, near-zero cost at Duravel scale |
| **Cloudflare Stream** | Free ingest+encode | ~$5 / 1,000 min stored (~$5/mo floor) | ~$1 / 1,000 delivered min | Signed URLs | Strong #2 — flat/predictable; no free delivery tier so pricier at low volume; no first-class multi-policy-ID split |
| **Vimeo (API/Pro+)** | included | plan-based caps | plan bandwidth | domain privacy; weak per-user gating | Fine for embeds; weak programmatic per-user gating; 2026 price rises |
| **YouTube (unlisted)** | free | free | free | none (unlisted ≠ private) | Only a $0 stopgap for *public* SEO clips; never for gated in-app |
| **Self-host (R2/S3 + HLS)** | your ffmpeg pipeline | cheap | egress + your player work | build it yourself | Not worth solo-founder eng time for ~30 clips |

**Cost model at realistic Duravel scale:**
- *MVP (~50–60 clips × ~1 min ≈ 60 stored min):* Mux storage ≈ **$0.14/mo**; delivery within the free tier for a long time → **~$0–$5/mo**. Cloudflare ≈ **$5/mo** storage floor + delivery.
- *At ~5,000 subscribers × ~30 watch-min/mo = 150,000 delivered min:* Mux ≈ (150k − 100k free) × ~$0.0008 ≈ **~$40/mo** + trivial storage. Cloudflare ≈ 150k × $0.001 ≈ **~$150/mo** + storage. Mux's free tier + lower per-minute wins as usage grows.
- **Mux Data** (QoE analytics) has its own free allotment (order ~100k views/mo); fine at MVP, monitor as usage grows.

**Signed playback implementation note.** Full-quality assets use `playback_policy: signed`; playback requires a **JWT signed with a Mux signing key**, minted server-side in the route handler (§4), scoped to the playback id + audience with short TTL. The **public** playback ID (separate, `public` policy) backs only the poster and SEO preview. Thumbnails/storyboards for the signed ID use their own audiences (`t`, `s`).

**Env / secret handling.** `MUX_SIGNING_PRIVATE_KEY` is a PEM; store it **base64-encoded** in Vercel env to avoid newline mangling and decode at runtime. All Mux secrets are server-only (never `NEXT_PUBLIC_*`).

**Production tooling (one-time / cheap):** smartphone (owned) + ~$40–$120 tripod/phone clamp + ~$80–$150 LED/ring light; natural gym light where possible. No mic (on-screen text cues, music-free or royalty-free bed). Editing: CapCut / DaVinci Resolve (free) or Descript (~$12–$24/mo). One-time hardware **~$150–$300**; ongoing **~$0–$25/mo**.

---

## 8. Domain / Training-Science Basis

Coaching content should encode established HYROX station technique — performance levers, not decoration. Representative cue sets (author per movement; re-verify against reputable sources and current HYROX rules before publishing):

- **Wall balls:** full squat depth to standard; drive through heels; catch-and-rebound timing (absorb into the next squat rather than pausing); consistent target aim. *Fault:* short-arming the throw and stalling under fatigue. Highest-rep station — pacing/breathing matter as much as strength.
- **Sled push:** low body angle; arms near-extended; short powerful strides on the balls of the feet; continuous drive (avoid stop-start); footwear grip matters. A top time-loss station.
- **Sled pull:** hand-over-hand vs. sit-back-and-drive; hip drive; stay low; efficient rope reset; foot bracing.
- **Ski erg:** full hip hinge + lat engagement (not arms-only); rhythmic compression; avoid early arm bend.
- **Row:** legs–core–arms sequence and reverse on recovery; drive-to-recovery ratio; damper/pacing.
- **Burpee broad jumps:** minimize vertical waste; controlled chest-to-ground; immediate jump; consistent jump distance to reduce total reps.
- **Farmers carry:** grip strategy; tall posture; brisk turnover; minimize drops/resets.
- **Sandbag lunges:** bag placement high on back/shoulders; knee tracking; consistent stride; hip drive out of the bottom.

**Strength movements the engine prescribes (author cues for the most-programmed):** back/front squat, deadlift, Romanian deadlift, hip thrust, walking lunge, split squat, overhead press, push press, pull-up, bent-over row, plus core (hollow, plank variations). Cues focus on load-bearing safety and positional integrity **under fatigue** — the endurance-strength context the engine programs for.

**Personalization principle:** generic technique is universal; *dose* is individual. The engine owns loads/reps/paces, so the library teaches the movement and defers every number to the engine (the "coach's note," §5, bridges the two without duplicating truth).

**Trademark / rights note (new).** "HYROX" is a trademarked brand; use it **nominatively/descriptively** (to identify the format), avoid any implication of official endorsement or partnership, and do not film inside sanctioned HYROX events without rights. If filming anyone other than Levi, get a simple written likeness release. Do not use third-party clips without license (no scraping YouTube).

*(Technique sources: Hybrid Athlete Club, Rox Lyfe, Persistence Athletics, PureGym, HyroxDataLab — re-verify against these and the official HYROX rulebook before publishing.)*

---

## 9. Risks & Open Questions

**Risks**
1. **Content production is the real bottleneck, not code.** Shooting/editing ~30 quality clips solo can stall GA. *Mitigation:* phase content (8 stations first), batch-shoot in 1–2 sessions, short text-cued clips (no VO), accept a "good enough v1," and ship pages with cues before video via the "coming soon" state.
2. **Label/resolution drift — the biggest correctness risk.** Haiku phrases exercises, so labels aren't a fixed set. *Mitigation (layered):* persist `movement_slug` at generation time from a closed enum (§5); Zod-validate; render-time resolver with a normalization pipeline as fallback; **vitest fixtures over station + top-lift labels and representative Haiku phrasings**; **production logging of every unresolved label** to tune aliases/enum. Never render a broken button on a miss.
3. **SEO ↔ gating tension.** Signed URLs expire → bad for crawlers. *Mitigation:* dual playback IDs (public poster/preview for SEO, signed for in-app); JSON-LD uses only public/durable URLs; draft rows are `anon`-invisible via the `status='published'` policy.
4. **Signed-token leakage / hotlinking.** *Mitigation:* short-TTL JWTs, server-only signing key, per-playback-id + audience scope, **rate-limited** token route; no long-lived public ID for the full-quality asset.
5. **Webhook redelivery / race.** `asset.ready` can fire multiple times or out of order. *Mitigation:* unique `(provider, provider_asset_id)` + upsert; webhook is the sole writer; ingest UI/script polls status rather than assuming immediate readiness.
6. **Cost surprise at scale.** *Mitigation:* Mux free tier covers early growth; posters (not autoplay) in grids; monitor Mux Data; cap any preview autoplay.
7. **Rights / likeness / trademark.** Releases for non-Levi subjects; nominative HYROX use only; no unlicensed third-party clips (§8).

**Open questions**
- **Gating (needs a call).** Library = (a) fully public, (b) auth-only, or (c) **partially public — metadata public, full playback authenticated**? *Recommendation: (c).* Confirm it does **not** sit behind `BILLING_ENABLED` (recommendation: it does not — generation and Apply remain the paid line; the public library is the funnel).
- **House format:** 9:16 vs 1:1? *Recommend 9:16* for mobile-web and future native reuse.
- **Persist `movement_slug` at generation vs resolve at render?** *Recommend persist (additive JSON field, no migration) as authoritative, resolver as fallback.*
- **Captions/transcripts in MVP or later?** *Later* — `videos.captions_url` provisioned now.
- **Admin UX vs seed script for the first ~30 clips?** *A seed script likely beats building `/admin/library` for v1;* build the admin UI only when re-authoring cadence justifies it.

---

## 10. Effort Estimate + Phased Build Plan

**Engineering: M.** **Overall (with content + resolver/telemetry): M–L.** Engineering is small and mostly pattern-following; **content production is the long pole** and the `movement_slug`/resolver/telemetry work is more than trivial. Realistic engineering effort ≈ **3–5 focused build-days**, with content running in parallel over 1–2 batch shoots plus editing.

| Component | Size | Notes |
|---|---|---|
| Migrations 0019–0021 + RLS + `updated_at` triggers | **S** | Mirrors existing patterns; check for an existing `set_updated_at` |
| Mux account, signing keys, dual-playback-ID setup, webhook | **S–M** | Node SDK + Next.js examples; signature verify + idempotent upsert |
| `resolveMovement` normalization + vitest fixtures + unresolved-label logging | **M** | Correctness-critical; test station + top-lift + Haiku phrasings |
| Generation `movement_slug` emission (closed enum + Zod) | **S–M** | Additive to existing validated generation path |
| Library index + detail (ISR, SEO, JSON-LD, "coming soon") | **M** | Server components, `generateStaticParams`, public-ID posters |
| Playback-token route (signed JWT, rate-limited) + Mux Player drawer | **M** | The user-visible core; the auth choke point |
| Admin ingest (or seed script) | **S** | Prefer a script for the first ~30 clips |
| **Content: 8 stations + top ~20 lifts** | **M–L** | Filming/editing; parallel; gates GA |

### Phase A — Foundation (Eng, ~1–1.5 days)
Migrations 0019–0021 + RLS + `updated_at` triggers. Mux account + signing keys + webhook secret in Vercel env (private key base64). Idempotent Mux webhook (sole writer of `videos.status`). `resolveMovement` with full vitest coverage + unresolved-label logging. **Gate: `next build` green + tests pass.**

### Phase B — Read surfaces (Eng, ~1 day)
`/library` index + `/library/[slug]` detail as server components with ISR, SEO metadata + `VideoObject` JSON-LD (public/durable URLs only), and the "demo coming soon" state. **Seed the 8 station rows** (metadata + cues, `status='published'`) even before videos land, so pages exist and rank.

### Phase C — Generation link + in-workout integration (Eng, ~1–1.5 days)
Add `movement_slug` emission to generation (closed enum + Zod, resolver fallback). Playback-token route (signed JWT, rate-limited). "Watch technique" affordance + Mux Player drawer in the session view, wired through the persisted slug / resolver. First-run hint.

### Phase D — Content production (Levi, parallel, ~1–2 batch sessions + editing)
Shoot the **8 HYROX stations** first (unblocks highest-value pages), then the **top ~20 prescribed lifts**. Batch-film, text-cue overlays, no VO. Ingest via seed script → Mux → link to movements. Publish per-movement as its video reaches `ready`.

### Phase E — GA + polish
Ship publicly once the 8 stations + top lifts are live. Confirm the gating decision (§9). Turn on Mux Data monitoring. Review unresolved-label logs and top up aliases/enum.

### Later phases (separate spec when scheduled)
Variations/regressions; adaptation-driven fault-fix recommendations in weekly review; Haiku coach's-note personalization; captions/transcripts; search/filter; triathlon/Ironman movement set.

---

### Appendix: environment / config additions (no secrets here)
- **Env (Vercel, server-only):** `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_SIGNING_KEY_ID`, `MUX_SIGNING_PRIVATE_KEY` (base64 PEM), `MUX_WEBHOOK_SECRET`. Optional: rate-limiter store creds (e.g. Upstash) for the token route.
- **New dirs:** `lib/library/` (resolver, admin actions, Mux client, seed script), `app/library/`, `app/admin/library/`, `app/api/library/playback-token/`, `app/api/webhooks/mux/`.
- **Conventions honored:** `next build` is the real gate; pure `resolveMovement` unit-tested with vitest; untyped Supabase queries cast `as`; service-role admin client is the sole writer for library content; Mux webhook is the sole writer of video readiness (mirrors the Stripe-webhook-sole-writer pattern); `BILLING_ENABLED` untouched (library deliberately lighter-gated); repo stays outside cloud-sync folders.

---

**Sources**
- Mux: [Video pricing](https://www.mux.com/docs/pricing/video) · [pricing (raw)](https://www.mux.com/docs/pricing.txt) · [secure playback](https://www.mux.com/docs/guides/secure-video-playback) · [signing JWTs](https://www.mux.com/docs/guides/signing-jwts) · [Node SDK](https://github.com/muxinc/mux-node-sdk) · [Next.js backend example](https://github.com/muxinc/nextjs-backend-example)
- Cloudflare Stream: [pricing](https://developers.cloudflare.com/stream/pricing/) · [2026 comparison](https://www.buildmvpfast.com/api-costs/video)
- Vimeo: [pricing 2026](https://swarmify.com/blog/vimeo-pricing-bandwidth-limits/) · [Developer API](https://developer.vimeo.com/)
- HYROX technique: [Sled push](https://hybridathleteclub.com/optimize-your-hyrox-sled-push-technique) · [Wall balls](https://hybridathleteclub.com/optimize-your-hyrox-wall-ball-technique) · [Sled pull](https://hybridathleteclub.com/optimising-your-hyrox-sled-pull-technique) · [Stations explained](https://persistenceathletics.com/fitness-tips/hyrox/stations-explained) · [Improve sled push](https://hyroxdatalab.com/articles/improve-sled-push-time) · [Wall balls guide](https://roxlyfe.com/hyrox-wall-balls-guide/)
- Competitor landscape: [Athletica AI HYROX library](https://athletica.ai/blog/hyrox-strength-training-athletica-global-library) · [RoxHype](https://www.roxhype.com/) · [TrainingPeaks HYROX](https://www.trainingpeaks.com/hyrox/)
- Production: [Filming pro exercise videos (2026)](https://cloudfit.tv/blog/create-exercise-videos-that-look-like-they-were-filmed-by-a-pro/)
