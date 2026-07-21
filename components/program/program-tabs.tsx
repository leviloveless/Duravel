"use client";

import { useState } from "react";

/**
 * Tabbed container for the program page. The server renders each tab's content
 * (ProgramView, SessionTracker, pace plan, VDOT, readiness, daily HR/HRV, weekly
 * summary, budget) and passes them here as ReactNodes; this component just owns
 * the active-tab state and shows one at a time. Only the active tab is mounted,
 * so per-tab forms re-init on switch (they all persist to the server anyway).
 */

export interface ProgramTab {
  id: string;
  label: string;
  content: React.ReactNode;
}

export default function ProgramTabs({ tabs }: { tabs: ProgramTab[] }) {
  const [active, setActive] = useState<string>(tabs[0]?.id ?? "");
  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <div className="flex flex-col gap-5">
      {/* Tab bar — horizontally scrollable on small screens */}
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div role="tablist" className="flex min-w-max gap-1 border-b border-zinc-200">
          {tabs.map((t) => {
            const on = t.id === current?.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setActive(t.id)}
                className={`whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors ${
                  on
                    ? "border-black text-black"
                    : "border-transparent text-zinc-500 hover:text-zinc-800"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>{current?.content}</div>
    </div>
  );
}
