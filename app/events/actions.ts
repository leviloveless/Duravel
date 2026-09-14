"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { parseIsoDate } from "@/lib/engine/race-dates";

/**
 * Event CRUD (2026-09-14).
 *
 * ⚠️ Every write is scoped to `source = "athlete"` as well as to the row id.
 * RLS already stops one athlete touching another's rows, but it does NOT stop an
 * athlete deleting the race row the GENERATOR wrote for their own program —
 * which would leave a block whose race no longer exists anywhere. Rows the
 * generator owns are edited by regenerating the program, not from here.
 */

export type EventState = { error: string | null; ok: boolean };

const PRIORITIES = ["A", "B", "C"] as const;

const EventSchema = z.object({
  name: z.string().trim().max(120).optional(),
  raceDate: z.string().trim().min(1, "Pick a date for the race."),
  priority: z.enum(PRIORITIES),
  sport: z.string().trim().max(40).optional(),
  goalTime: z.string().trim().max(16).optional(),
  notes: z.string().trim().max(500).optional(),
});

function parse(formData: FormData) {
  return EventSchema.safeParse({
    name: formData.get("name") ?? undefined,
    raceDate: formData.get("raceDate") ?? "",
    priority: formData.get("priority") ?? "A",
    sport: formData.get("sport") ?? undefined,
    goalTime: formData.get("goalTime") ?? undefined,
    notes: formData.get("notes") ?? undefined,
  });
}

/**
 * Is this a real, plausible race date?
 *
 * Deliberately NOT `checkRaceDates` — that one validates a set of races against
 * a program's start date, and a standalone event has no program and therefore no
 * start date to be checked against. What carries over is the part that matters
 * here: the year guard, which exists because an A race stored as year `0226`
 * produced three separate, unrelated-looking bug reports. An event date can be
 * carried into a program builder later, so it gets the same scrutiny at entry.
 */
function dateProblem(raceDate: string): string | null {
  const date = parseIsoDate(raceDate);
  if (!date) {
    return `${raceDate} isn't a real calendar date. Pick it from the date field.`;
  }
  const year = date.getUTCFullYear();
  if (year < 2000 || year > 2100) {
    return `That race is dated ${raceDate} — the year looks wrong. Check the four digits.`;
  }
  return null;
}

export async function createEvent(_prev: EventState, formData: FormData): Promise<EventState> {
  const parsed = parse(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check those details.", ok: false };
  }
  const bad = dateProblem(parsed.data.raceDate);
  if (bad) return { error: bad, ok: false };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in.", ok: false };

  const { error } = await supabase.from("events").insert({
    user_id: user.id,
    program_id: null,
    race_date: parsed.data.raceDate,
    priority: parsed.data.priority,
    name: parsed.data.name || null,
    sport: parsed.data.sport || null,
    goal_time: parsed.data.goalTime || null,
    notes: parsed.data.notes || null,
    source: "athlete",
  });
  if (error) return { error: error.message, ok: false };

  revalidatePath("/events");
  revalidatePath("/dashboard");
  return { error: null, ok: true };
}

export async function updateEvent(
  id: string,
  _prev: EventState,
  formData: FormData,
): Promise<EventState> {
  const parsed = parse(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check those details.", ok: false };
  }
  const bad = dateProblem(parsed.data.raceDate);
  if (bad) return { error: bad, ok: false };

  const supabase = await createClient();
  const { error } = await supabase
    .from("events")
    .update({
      race_date: parsed.data.raceDate,
      priority: parsed.data.priority,
      name: parsed.data.name || null,
      sport: parsed.data.sport || null,
      goal_time: parsed.data.goalTime || null,
      notes: parsed.data.notes || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("source", "athlete");
  if (error) return { error: error.message, ok: false };

  revalidatePath("/events");
  revalidatePath("/dashboard");
  return { error: null, ok: true };
}

export async function deleteEvent(id: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("events").delete().eq("id", id).eq("source", "athlete");
  revalidatePath("/events");
  revalidatePath("/dashboard");
}
