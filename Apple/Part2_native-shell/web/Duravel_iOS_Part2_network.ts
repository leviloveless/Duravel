/**
 * Duravel — Network / connectivity controller
 * ------------------------------------------------------------------
 * Watches connectivity via @capacitor/network and app foreground state via
 * @capacitor/app. When the device goes offline (or the hosted shell fails to
 * load), it shows the native-feeling offline overlay (offline.html content),
 * and hides it + fires an onReconnect callback when connectivity returns.
 *
 * Install:
 *   npm i @capacitor/network @capacitor/app
 *   npx cap sync ios
 *
 * The offline UI is injected as an overlay <div> so it works even if the remote
 * web app never loaded. The markup mirrors Duravel_iOS_Part2_offline.html — keep
 * them in sync (that standalone file is also useful as a Capacitor errorPath /
 * for manual testing in a browser).
 */

import { Capacitor } from '@capacitor/core';
import { Network, type ConnectionStatus } from '@capacitor/network';
import { App } from '@capacitor/app';

const isNative = Capacitor.isNativePlatform();

export interface NetworkControllerOptions {
  /** Called when connectivity is restored after being offline. */
  onReconnect?: () => void;
  /** Called each time offline is detected. */
  onOffline?: () => void;
  /** Provide a custom reload action. Default: location.reload(). */
  onRetry?: () => void;
}

const OVERLAY_ID = 'duravel-offline-overlay';

function overlayHTML(): string {
  // Self-contained; inline styles so it renders with zero external deps even if
  // the web app's CSS never loaded. Colors match brand #0B0B0F.
  return `
  <div id="${OVERLAY_ID}" role="alertdialog" aria-live="assertive" aria-label="No connection" style="
      position:fixed; inset:0; z-index:2147483647;
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      padding: env(safe-area-inset-top,0) 24px env(safe-area-inset-bottom,0);
      background:#0B0B0F; color:#F5F5F7;
      font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,sans-serif;
      -webkit-user-select:none; user-select:none; text-align:center;">
    <div style="width:72px;height:72px;border-radius:20px;display:flex;align-items:center;justify-content:center;
                background:rgba(232,255,89,0.10);margin-bottom:24px;">
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#E8FF59" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M1 1l22 22"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/>
        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
        <line x1="12" y1="20" x2="12.01" y2="20"/>
      </svg>
    </div>
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:600;letter-spacing:-0.01em;">You're offline</h1>
    <p style="margin:0 0 28px;max-width:300px;font-size:15px;line-height:1.5;color:#A1A1AA;">
      Duravel needs a connection to sync your training. Check your Wi-Fi or cellular and try again.
    </p>
    <button id="${OVERLAY_ID}-retry" style="
        appearance:none;border:none;cursor:pointer;
        background:#E8FF59;color:#0B0B0F;font-weight:600;font-size:16px;
        padding:14px 32px;border-radius:14px;min-width:180px;
        transition:transform .12s ease, opacity .12s ease;">
      Try again
    </button>
    <div id="${OVERLAY_ID}-status" style="margin-top:18px;font-size:13px;color:#71717A;height:16px;"></div>
  </div>`;
}

export class NetworkController {
  private opts: NetworkControllerOptions;
  private wasOffline = false;
  private mounted = false;
  private listeners: Array<{ remove: () => void }> = [];

  constructor(opts: NetworkControllerOptions = {}) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    if (!isNative) return; // browser: rely on the web app's own handling
    const status = await Network.getStatus();
    this.apply(status);

    const netHandle = await Network.addListener('networkStatusChange', (s) => this.apply(s));
    this.listeners.push(netHandle);

    // Re-check when the app returns to foreground (connectivity may have changed
    // while backgrounded, and iOS can suspend the network listener).
    const appHandle = await App.addListener('appStateChange', async ({ isActive }) => {
      if (isActive) this.apply(await Network.getStatus());
    });
    this.listeners.push(appHandle);
  }

  async stop(): Promise<void> {
    for (const l of this.listeners) {
      try {
        l.remove();
      } catch {
        /* ignore */
      }
    }
    this.listeners = [];
  }

  private apply(status: ConnectionStatus): void {
    if (status.connected) {
      if (this.wasOffline) {
        this.hideOverlay();
        this.opts.onReconnect?.();
      }
      this.wasOffline = false;
    } else {
      this.wasOffline = true;
      this.showOverlay();
      this.opts.onOffline?.();
    }
  }

  private showOverlay(): void {
    if (this.mounted) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = overlayHTML().trim();
    const node = wrap.firstElementChild as HTMLElement;
    document.body.appendChild(node);
    this.mounted = true;

    const retry = document.getElementById(`${OVERLAY_ID}-retry`);
    const statusEl = document.getElementById(`${OVERLAY_ID}-status`);
    retry?.addEventListener('click', async () => {
      if (statusEl) statusEl.textContent = 'Checking…';
      retry.style.opacity = '0.6';
      const s = await Network.getStatus();
      if (s.connected) {
        this.hideOverlay();
        this.opts.onReconnect?.();
        if (this.opts.onRetry) this.opts.onRetry();
        else location.reload();
      } else {
        if (statusEl) statusEl.textContent = 'Still no connection';
        retry.style.opacity = '1';
      }
    });
  }

  private hideOverlay(): void {
    const node = document.getElementById(OVERLAY_ID);
    if (node) {
      node.style.transition = 'opacity .2s ease';
      node.style.opacity = '0';
      setTimeout(() => node.remove(), 200);
    }
    this.mounted = false;
  }
}
