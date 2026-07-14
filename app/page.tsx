import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-4xl font-bold tracking-tight">Duravel</h1>
      <p className="max-w-md text-lg text-zinc-600">
        AI-powered HYROX training programs, periodized to your race and
        experience — running, lifting, and hybrid work in one plan.
      </p>
      <Link
        href="/onboarding"
        className="rounded-full bg-black px-6 py-3 text-white transition-colors hover:bg-zinc-800"
      >
        Build your program
      </Link>
    </main>
  );
}
