export default async function ProgramPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 px-6 py-24">
      <h1 className="text-2xl font-semibold">Program {id}</h1>
      <p className="text-zinc-600">Full program view — Milestone 6.</p>
    </main>
  );
}
