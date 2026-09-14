import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserEvents } from "@/lib/supabase/queries";
import { byDate } from "@/lib/events/derive";
import EventManager from "@/components/events/event-manager";

export const metadata: Metadata = {
  title: "Races — Duravel",
  description: "Every race on your calendar, with or without a program built for it.",
};

export default async function EventsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const events = byDate(await getUserEvents());

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-bold tracking-wide uppercase">Races</h1>
        <p className="max-w-[62ch] text-zinc-600">
          Everything you are pointing at, whether or not you have built a block for it. An A race is
          what a program peaks for; B and C races are trained through.
        </p>
      </header>
      <div className="tick-tape" aria-hidden="true" />
      <EventManager events={events} />
    </main>
  );
}
