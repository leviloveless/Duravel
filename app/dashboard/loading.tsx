/** Dashboard loading fallback (roadmap #3.7) — shown while server data streams. */
export default function DashboardLoading() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-16">
      <div className="h-7 w-56 animate-pulse rounded bg-zinc-100" />
      <div className="h-24 w-full animate-pulse rounded-xl bg-zinc-100" />
      <div className="h-12 w-full animate-pulse rounded-lg bg-zinc-100" />
      <div className="h-12 w-full animate-pulse rounded-lg bg-zinc-100" />
    </main>
  );
}
