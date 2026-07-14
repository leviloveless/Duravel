"use client";

/**
 * Global error boundary (roadmap #3.7) — the last resort for errors thrown in
 * the root layout itself, where the normal error.tsx can't render. Must include
 * its own <html>/<body>.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="mx-auto flex max-w-lg flex-col items-start gap-4 px-6 py-24">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="text-sm text-zinc-600">The app hit an unexpected error. Please try again.</p>
        {error.digest && <p className="text-xs text-zinc-400">Reference: {error.digest}</p>}
        <button
          type="button"
          onClick={reset}
          className="rounded-full bg-black px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
