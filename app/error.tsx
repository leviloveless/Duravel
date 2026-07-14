"use client";

import { Button } from "@/components/ui/button";

/**
 * Route error boundary (roadmap #3.7). Catches render/data errors in any app
 * segment that lacks its own error.tsx, so a failed Supabase call or thrown
 * exception shows a recovery UI instead of blanking the page.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex max-w-lg flex-col items-start gap-4 px-6 py-24">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-zinc-600">
        We hit an error loading this page. You can try again — if it keeps happening, head back to your dashboard.
      </p>
      {error.digest && <p className="text-xs text-zinc-400">Reference: {error.digest}</p>}
      <div className="flex gap-2">
        <Button variant="primary" size="sm" onClick={reset}>
          Try again
        </Button>
        <Button variant="secondary" size="sm" onClick={() => (window.location.href = "/dashboard")}>
          Back to dashboard
        </Button>
      </div>
    </main>
  );
}
