// Duravel iOS — Part 5 (HealthKit & wearables)
// HealthKitPrimingScreen.tsx
//
// Explain-before-prompt priming screen. Renders ONLY on iOS where Health is
// available; otherwise the parent should not mount it (or it renders the
// "unavailable" state). Tapping "Connect Apple Health" triggers the native
// HealthKit sheet, then registers background sync and does an initial pull.
//
// This is framework-plain React (hooks + inline styles) so it drops in without
// assuming Duravel's exact design system. Swap inline styles for Duravel tokens
// / Tailwind classes and the buttons for the app's <Button> component.
//
// Place in the web app under: src/native/health/HealthKitPrimingScreen.tsx

import { useCallback, useEffect, useState } from 'react';
import { duravelHealth } from './healthkit.service';

type Phase = 'checking' | 'unavailable' | 'priming' | 'connecting' | 'connected' | 'no-data';

interface Props {
  /** Called after a successful connect (whether or not workouts were found). */
  onConnected?: (syncedCount: number) => void;
  /** Called when the user dismisses without connecting. */
  onDismiss?: () => void;
}

const DATA_POINTS: { title: string; detail: string }[] = [
  { title: 'Workouts', detail: 'Runs, rides, strength, HYROX and more sync into your log' },
  { title: 'Heart rate & HRV', detail: 'So your coach can read effort and recovery' },
  { title: 'VO2 max & resting heart rate', detail: 'Track fitness trends over time' },
  { title: 'Calories & distance', detail: 'Complete the picture of each session' },
];

export function HealthKitPrimingScreen({ onConnected, onDismiss }: Props) {
  const [phase, setPhase] = useState<Phase>('checking');

  useEffect(() => {
    let active = true;
    void (async () => {
      const available = await duravelHealth.isAvailable();
      if (!active) return;
      setPhase(available ? 'priming' : 'unavailable');
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleConnect = useCallback(async () => {
    setPhase('connecting');
    // Read grants are not introspectable; `granted` only tells us the sheet was
    // handled. We proceed to sync and infer state from whether data comes back.
    await duravelHealth.requestAuthorization();
    await duravelHealth.enableAutoSync();
    const count = await duravelHealth.syncNow();
    onConnected?.(count);
    setPhase(count > 0 ? 'connected' : 'no-data');
  }, [onConnected]);

  if (phase === 'checking') {
    return <CenteredNote text="Checking Apple Health…" />;
  }

  if (phase === 'unavailable') {
    return (
      <CenteredNote text="Apple Health isn't available on this device. Open Duravel on your iPhone to connect your workouts." />
    );
  }

  if (phase === 'connected') {
    return (
      <CenteredNote text="Connected to Apple Health. Your training and recovery will stay up to date automatically." />
    );
  }

  if (phase === 'no-data') {
    return (
      <div style={styles.container}>
        <h2 style={styles.title}>You're connected</h2>
        <p style={styles.subtitle}>
          New workouts from Apple Watch will show up automatically. Nothing here
          yet — record a workout, or check that Duravel has access in the Health app.
        </p>
        <button
          style={styles.secondaryBtn}
          onClick={() => window.open('app-settings:', '_system')}
        >
          Open Health settings
        </button>
      </div>
    );
  }

  // phase === 'priming' | 'connecting'
  const busy = phase === 'connecting';
  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Connect Apple Health</h2>
      <p style={styles.subtitle}>
        Bring your training and recovery into Duravel automatically.
      </p>

      <ul style={styles.list}>
        {DATA_POINTS.map((d) => (
          <li key={d.title} style={styles.listItem}>
            <span style={styles.listTitle}>{d.title}</span>
            <span style={styles.listDetail}>{d.detail}</span>
          </li>
        ))}
      </ul>

      <p style={styles.privacy}>
        Your health data stays private, is only used to power your Duravel
        training, and is never sold. You choose what to share on the next screen.
      </p>

      <button style={styles.primaryBtn} onClick={handleConnect} disabled={busy}>
        {busy ? 'Connecting…' : 'Connect Apple Health'}
      </button>
      <button
        style={styles.textBtn}
        onClick={() => onDismiss?.()}
        disabled={busy}
      >
        Not now
      </button>
    </div>
  );
}

function CenteredNote({ text }: { text: string }) {
  return (
    <div style={{ ...styles.container, justifyContent: 'center' }}>
      <p style={styles.subtitle}>{text}</p>
    </div>
  );
}

// Placeholder styles — replace with Duravel design tokens / className props.
const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    padding: '24px',
    gap: '12px',
    maxWidth: 480,
    margin: '0 auto',
    minHeight: '100%',
  },
  title: { fontSize: 24, fontWeight: 700, margin: 0 },
  subtitle: { fontSize: 16, opacity: 0.8, margin: 0 },
  list: { listStyle: 'none', padding: 0, margin: '8px 0', display: 'flex', flexDirection: 'column', gap: 12 },
  listItem: { display: 'flex', flexDirection: 'column' },
  listTitle: { fontWeight: 600 },
  listDetail: { fontSize: 14, opacity: 0.7 },
  privacy: { fontSize: 13, opacity: 0.6, marginTop: 8 },
  primaryBtn: {
    marginTop: 16, padding: '14px 20px', borderRadius: 12, border: 'none',
    fontSize: 16, fontWeight: 600, cursor: 'pointer',
  },
  secondaryBtn: {
    marginTop: 12, padding: '12px 20px', borderRadius: 12,
    border: '1px solid rgba(0,0,0,0.15)', background: 'transparent',
    fontSize: 15, cursor: 'pointer',
  },
  textBtn: {
    marginTop: 4, padding: '10px', border: 'none', background: 'transparent',
    fontSize: 15, opacity: 0.7, cursor: 'pointer',
  },
};
