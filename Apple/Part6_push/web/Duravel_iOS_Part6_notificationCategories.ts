/**
 * Duravel iOS — Part 6
 * Notification categories, typed deep-link payloads, and tap → route wiring.
 *
 * Design:
 *  - Every push carries a small, typed `data` payload with a `link` field that
 *    is a `duravel://` deep link. On tap we hand that link to the SAME Part 3
 *    deep-link handler that already routes `duravel://` universal/custom-scheme
 *    links, so there is ONE routing table for the whole app.
 *  - We keep the visible alert (title/body) separate from routing data. The
 *    server sets both; the client only reads `data` for routing.
 *  - iOS notification "categories" (aps.category) map to actionable buttons
 *    (e.g. "Start", "Snooze"). These are declared here and registered natively;
 *    action taps route through the same handler with a per-action link.
 *
 * IMPORTANT: this file imports the Part 3 handler. Adjust the import path to the
 * actual location in the repo (see WIRING NOTE at bottom). We reference it as
 * `handleDeepLink(url: string)`.
 */

import { PushNotifications, type ActionPerformed } from '@capacitor/push-notifications';

// ⬇️ Part 3 deep-link handler. Rename/repath to match the repo.
// Expected signature: (url: string) => void | Promise<void>
import { handleDeepLink } from '../deeplinks/handleDeepLink';

// ─────────────────────────────────────────────────────────────────────────────
// Category identifiers — MUST match aps.category set by the send path and the
// native category registration (below / or in AppDelegate for action buttons).
// ─────────────────────────────────────────────────────────────────────────────

export const PushCategory = {
  TRIAL_ENDING: 'trial_ending',
  WORKOUT_REMINDER: 'workout_reminder',
  STREAK: 'streak',
  PLAN_UPDATED: 'plan_updated',
  ACCOUNT: 'account',
  MARKETING: 'marketing',
} as const;

export type PushCategory = (typeof PushCategory)[keyof typeof PushCategory];

// ─────────────────────────────────────────────────────────────────────────────
// Typed payloads. The server MUST send `data.link` as a duravel:// URL and
// `data.category` matching one of the above. Extra fields are category-specific
// and optional (used for optimistic UI before the deep-link screen loads).
// ─────────────────────────────────────────────────────────────────────────────

export interface BasePushData {
  category: PushCategory;
  /** duravel:// deep link routed through the Part 3 handler. Source of truth. */
  link: string;
  /** Opaque id for de-dupe / analytics. */
  notif_id?: string;
}

export interface WorkoutReminderData extends BasePushData {
  category: 'workout_reminder';
  session_id: string;
  program_id?: string;
  starts_at?: string; // ISO
}

export interface PlanUpdatedData extends BasePushData {
  category: 'plan_updated';
  program_id: string;
}

export interface TrialEndingData extends BasePushData {
  category: 'trial_ending';
  days_left?: number;
}

export interface StreakData extends BasePushData {
  category: 'streak';
  streak_days?: number;
}

export type PushData =
  | WorkoutReminderData
  | PlanUpdatedData
  | TrialEndingData
  | StreakData
  | BasePushData;

// ─────────────────────────────────────────────────────────────────────────────
// Canonical deep links. Keep these in ONE place so client + server agree.
// The routes themselves are owned by the Part 3 handler; these builders just
// produce the URLs. Server-side has a mirrored copy (see edge fn).
// ─────────────────────────────────────────────────────────────────────────────

export const DeepLinks = {
  session: (sessionId: string) => `duravel://session/${encodeURIComponent(sessionId)}`,
  program: (programId: string) => `duravel://program/${encodeURIComponent(programId)}`,
  billing: () => `duravel://account/billing`,
  streak: () => `duravel://progress/streak`,
  home: () => `duravel://home`,
} as const;

/** Fallback link per category if the server omitted `data.link` (defensive). */
export function fallbackLinkForCategory(cat: PushCategory, data: Partial<PushData>): string {
  switch (cat) {
    case 'workout_reminder':
      return (data as WorkoutReminderData).session_id
        ? DeepLinks.session((data as WorkoutReminderData).session_id)
        : DeepLinks.home();
    case 'plan_updated':
      return (data as PlanUpdatedData).program_id
        ? DeepLinks.program((data as PlanUpdatedData).program_id)
        : DeepLinks.home();
    case 'trial_ending':
      return DeepLinks.billing();
    case 'streak':
      return DeepLinks.streak();
    default:
      return DeepLinks.home();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// iOS actionable categories (buttons). These give the "Start" / "Snooze" style
// actions on a notification. Action taps produce ActionPerformed with
// actionId !== 'tap'; we map each to a deep link.
//
// NOTE: registering categories with action buttons requires the native
// UNUserNotificationCenter category registration. With Capacitor, the simplest
// path is to register them in AppDelegate (see reference swift). The JS below
// documents the intended mapping and handles the resulting actionIds.
// ─────────────────────────────────────────────────────────────────────────────

export const CategoryActions: Record<
  string,
  { id: string; title: string; toLink: (d: PushData) => string }[]
> = {
  [PushCategory.WORKOUT_REMINDER]: [
    {
      id: 'START_SESSION',
      title: 'Start',
      toLink: (d) => (d as WorkoutReminderData).session_id
        ? DeepLinks.session((d as WorkoutReminderData).session_id)
        : DeepLinks.home(),
    },
    // "Snooze" routes home with a query the app reads to re-schedule locally.
    {
      id: 'SNOOZE_SESSION',
      title: 'Snooze 1h',
      toLink: (d) => `${DeepLinks.home()}?snooze_session=${
        (d as WorkoutReminderData).session_id ?? ''
      }`,
    },
  ],
  [PushCategory.PLAN_UPDATED]: [
    {
      id: 'VIEW_PLAN',
      title: 'View plan',
      toLink: (d) => (d as PlanUpdatedData).program_id
        ? DeepLinks.program((d as PlanUpdatedData).program_id)
        : DeepLinks.home(),
    },
  ],
  [PushCategory.TRIAL_ENDING]: [
    { id: 'VIEW_BILLING', title: 'Manage plan', toLink: () => DeepLinks.billing() },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Tap routing. Bind ONCE on launch (see registration wiring example).
// ─────────────────────────────────────────────────────────────────────────────

let _tapBound = false;

/**
 * Wire pushNotificationActionPerformed → deep-link handler. `navigate` is the
 * app's router push, used only as a hint; the Part 3 `handleDeepLink` performs
 * the actual navigation. We call handleDeepLink so behaviour is identical to a
 * user opening a duravel:// link from Safari/Mail.
 */
export async function bindPushTapRouting(navigate?: (path: string) => void): Promise<void> {
  if (_tapBound) return;
  _tapBound = true;

  await PushNotifications.addListener(
    'pushNotificationActionPerformed',
    async (action: ActionPerformed) => {
      try {
        const raw = action.notification.data ?? {};
        const data = normalizePushData(raw);
        const link = resolveTapLink(action, data);
        if (link) {
          await Promise.resolve(handleDeepLink(link));
        } else if (navigate) {
          navigate('/');
        }
      } catch {
        // Never throw out of a system callback.
        if (navigate) navigate('/');
      }
    },
  );

  // Foreground receipt (app open): optional — surface an in-app toast, do NOT
  // auto-navigate (would be janky). Left as a hook.
  await PushNotifications.addListener('pushNotificationReceived', () => {
    // e.g. bump an in-app badge / toast. Intentionally no navigation.
  });
}

/** APNs delivers data as string values; coerce/normalize into PushData. */
export function normalizePushData(raw: Record<string, unknown>): PushData {
  const category = (raw.category as PushCategory) ?? PushCategory.MARKETING;
  const base: BasePushData = {
    category,
    link: typeof raw.link === 'string' ? raw.link : '',
    notif_id: typeof raw.notif_id === 'string' ? raw.notif_id : undefined,
  };
  // Pass through category-specific fields untouched (all strings from APNs).
  return { ...raw, ...base } as PushData;
}

/**
 * Decide the link for a tap. If an action button was tapped (actionId not the
 * default 'tap'), use the mapped action link; otherwise use data.link, falling
 * back to a category default if the server omitted it.
 */
export function resolveTapLink(action: ActionPerformed, data: PushData): string {
  const actionId = action.actionId;
  if (actionId && actionId !== 'tap') {
    const actions = CategoryActions[data.category] ?? [];
    const match = actions.find((a) => a.id === actionId);
    if (match) return match.toLink(data);
  }
  if (data.link && data.link.startsWith('duravel://')) return data.link;
  return fallbackLinkForCategory(data.category, data);
}

/*
──────────────────────────────────────────────────────────────────────────────
WIRING NOTE
──────────────────────────────────────────────────────────────────────────────
1. Import path: change `../deeplinks/handleDeepLink` to wherever Part 3 exported
   its handler. If Part 3 exposed something like `router.handleUrl(url)` or an
   App-URL listener, wrap it:
       export const handleDeepLink = (url: string) => appUrlOpen({ url });

2. Action buttons: to show "Start"/"Snooze" buttons, register the categories
   natively (UNNotificationCategory) — see Duravel_iOS_Part6_AppDelegate_reference.swift.
   Without that registration, notifications still deliver and TAP routing works;
   only the extra buttons are absent. The `aps.category` string must match the
   identifiers in `PushCategory`.

3. Cold start: if the app was launched by tapping a notification, Capacitor
   replays `pushNotificationActionPerformed` once listeners are bound, so binding
   early on launch (before first paint of the router) is enough — no extra
   getLaunchNotification call needed on iOS with the plugin.
──────────────────────────────────────────────────────────────────────────────
*/
