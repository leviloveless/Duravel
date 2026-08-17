/**
 * REGRESSION — a dismissed suggestion stays dismissed (Levi, 2026-08-13).
 *
 * ## The bug
 *
 * `sync-suggestions.tsx` had a Dismiss button that only ever set React state:
 *
 *     const [hidden, setHidden] = useState<Set<string>>(new Set());
 *
 * The card vanished until the next render and came straight back on reload, on
 * navigation, and on every `router.refresh()` — which the program view's new
 * Sync workouts button fires on *every* sync. Nothing was written down, so an
 * athlete dismissing the same Ride four times was not doing anything wrong.
 *
 * Migration 0043 adds `wearable_activities.suggestion_dismissed_at`, and this
 * pins the predicate that reads it.
 *
 * ## The distinction these tests exist to protect
 *
 * **Dismissal is NOT part of `isLinkCandidate`.** "Stop suggesting this" is not
 * "this workout never happened" (Levi's call). A dismissed activity must stay in
 * `linkableActivities` so it can still be attached by hand from the week table —
 * otherwise a mis-click is unrecoverable without a database edit.
 *
 * CONFIRM was already durable and is untouched: linking writes a `workout_logs`
 * row carrying `wearable_activity_id`, which makes the activity `linked`, and
 * `isLinkCandidate` already excluded linked activities from both lists.
 */
import { describe, it, expect } from "vitest";
import { isLinkCandidate, isSuggestionCandidate } from "./suggest-data";

const fresh = { linked: false, self_posted: false, suggestion_dismissed_at: null };

describe("dismissal hides the SUGGESTION, not the activity", () => {
  it("drops a dismissed activity from suggestions", () => {
    expect(isSuggestionCandidate(fresh)).toBe(true);
    expect(
      isSuggestionCandidate({ ...fresh, suggestion_dismissed_at: "2026-08-13T12:00:00.000Z" }),
    ).toBe(false);
  });

  it("KEEPS a dismissed activity manually linkable — the whole point", () => {
    // If this ever flips to false, a mis-clicked Dismiss becomes unrecoverable
    // from the UI. That is why dismissal lives in its own predicate.
    expect(
      isLinkCandidate({
        linked: false,
        self_posted: false,
        suggestion_dismissed_at: "2026-08-13",
      } as never),
    ).toBe(true);
  });

  it("treats an absent field as 'never dismissed' — pre-0043 rows and old clients", () => {
    expect(isSuggestionCandidate({ linked: false, self_posted: false })).toBe(true);
    expect(isSuggestionCandidate({ linked: false })).toBe(true);
  });
});

describe("the other two exclusions still hold for suggestions", () => {
  it("a LINKED activity is never suggested — this is why Confirm already worked", () => {
    expect(isSuggestionCandidate({ ...fresh, linked: true })).toBe(false);
    expect(isLinkCandidate({ ...fresh, linked: true })).toBe(false);
  });

  it("a SELF-POSTED activity is never suggested (migration 0040)", () => {
    // Duravel's own Strava auto-post is the PLAN, not a record of training.
    // Suggesting it lets the plan become its own evidence.
    expect(isSuggestionCandidate({ ...fresh, self_posted: true })).toBe(false);
    expect(isLinkCandidate({ ...fresh, self_posted: true })).toBe(false);
  });

  it("suggestion candidacy is strictly narrower than link candidacy", () => {
    const cases = [
      { linked: false, self_posted: false, suggestion_dismissed_at: null },
      { linked: false, self_posted: false, suggestion_dismissed_at: "2026-08-13" },
      { linked: true, self_posted: false, suggestion_dismissed_at: null },
      { linked: false, self_posted: true, suggestion_dismissed_at: null },
      { linked: true, self_posted: true, suggestion_dismissed_at: "2026-08-13" },
    ];
    for (const c of cases) {
      if (isSuggestionCandidate(c)) {
        expect(isLinkCandidate(c), JSON.stringify(c)).toBe(true);
      }
    }
    // ...and strictly narrower: at least one case is linkable but not suggested.
    const dismissed = cases[1]!;
    expect(isLinkCandidate(dismissed)).toBe(true);
    expect(isSuggestionCandidate(dismissed)).toBe(false);
  });
});
