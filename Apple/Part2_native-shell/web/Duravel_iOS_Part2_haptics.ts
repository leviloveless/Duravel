/**
 * Duravel — Haptics helper
 * ------------------------------------------------------------------
 * Semantic wrapper over @capacitor/haptics. The web app calls intent-named
 * functions (success/warning/error/selection/impact/...) and never touches the
 * raw plugin. Safe to import on web: on non-native platforms every call is a
 * no-op, so you can sprinkle these anywhere without platform guards.
 *
 * Install (native project, Part 1 already added Capacitor):
 *   npm i @capacitor/haptics
 *   npx cap sync ios
 *
 * Usage:
 *   import { haptics } from './Duravel_iOS_Part2_haptics';
 *   haptics.success();                 // e.g. workout logged
 *   haptics.selection();               // e.g. tab / segmented control change
 *   haptics.impact('light');           // e.g. button press
 *   await haptics.pattern('rest-over'); // e.g. interval timer transition
 */

import { Capacitor } from '@capacitor/core';
import {
  Haptics,
  ImpactStyle,
  NotificationType,
} from '@capacitor/haptics';

const isNative = Capacitor.isNativePlatform();

/** Swallow plugin errors — haptics must never break app flow. */
function safe(run: () => Promise<unknown> | void): Promise<void> {
  if (!isNative) return Promise.resolve();
  try {
    const r = run();
    return r instanceof Promise ? r.then(() => undefined).catch(() => undefined) : Promise.resolve();
  } catch {
    return Promise.resolve();
  }
}

export type ImpactWeight = 'light' | 'medium' | 'heavy';

const IMPACT_MAP: Record<ImpactWeight, ImpactStyle> = {
  light: ImpactStyle.Light,
  medium: ImpactStyle.Medium,
  heavy: ImpactStyle.Heavy,
};

export const haptics = {
  /** Positive confirmation — set logged, PR hit, plan generated. */
  success(): Promise<void> {
    return safe(() => Haptics.notification({ type: NotificationType.Success }));
  },

  /** Caution — form validation soft-fail, approaching a limit. */
  warning(): Promise<void> {
    return safe(() => Haptics.notification({ type: NotificationType.Warning }));
  },

  /** Failure — request failed, hard validation error. */
  error(): Promise<void> {
    return safe(() => Haptics.notification({ type: NotificationType.Error }));
  },

  /** Light tick for discrete UI changes — tab switch, picker, toggle. */
  selection(): Promise<void> {
    // selectionStart/Changed/End gives the crisp iOS "picker" feel.
    return safe(async () => {
      await Haptics.selectionStart();
      await Haptics.selectionChanged();
      await Haptics.selectionEnd();
    });
  },

  /** Physical tap for presses / drops. Defaults to medium. */
  impact(weight: ImpactWeight = 'medium'): Promise<void> {
    return safe(() => Haptics.impact({ style: IMPACT_MAP[weight] }));
  },

  /** Raw vibrate (ms). Prefer the semantic calls; use for custom timers. */
  vibrate(durationMs = 300): Promise<void> {
    return safe(() => Haptics.vibrate({ duration: durationMs }));
  },

  /**
   * Named multi-buzz patterns for training moments. Sequenced with small gaps
   * so they read as distinct pulses. Extend freely.
   */
  async pattern(
    name: 'countdown-tick' | 'interval-start' | 'rest-over' | 'workout-complete',
  ): Promise<void> {
    if (!isNative) return;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    switch (name) {
      case 'countdown-tick':
        await this.selection();
        break;
      case 'interval-start':
        await this.impact('heavy');
        break;
      case 'rest-over':
        await this.impact('medium');
        await wait(140);
        await this.impact('heavy');
        break;
      case 'workout-complete':
        await this.impact('heavy');
        await wait(120);
        await this.impact('heavy');
        await wait(120);
        await this.success();
        break;
    }
  },
};

export type HapticsApi = typeof haptics;
export default haptics;
