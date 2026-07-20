import { createClient } from "@/lib/supabase/server";
import type { Fundraiser } from "./fundraiser";

/** The single fundraiser row (#19). Public read (RLS allows anyone). */
export async function getFundraiser(): Promise<Fundraiser | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("fundraiser").select("*").eq("id", "main").maybeSingle();
  return (data as Fundraiser | null) ?? null;
}
