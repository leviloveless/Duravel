/** Program loading fallback (roadmap #3.7). */
export default function ProgramLoading() {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <div className="h-8 w-64 animate-pulse rounded bg-zinc-100" />
      <div className="h-40 w-full animate-pulse rounded-xl bg-zinc-100" />
      <div className="h-96 w-full animate-pulse rounded-xl bg-zinc-100" />
    </main>
  );
}
