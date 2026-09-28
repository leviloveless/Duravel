import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  completionNeeds,
  needsCompletion,
  onlyTermsUpdate,
  safeNext,
} from "@/lib/account-completion";
import { signOut } from "@/app/login/actions";
import WelcomeForm from "./welcome-form";

export const metadata: Metadata = {
  title: "Finish setting up · Duravel",
  robots: { index: false, follow: false },
};

/**
 * First-login step (2026-09-28). The proxy sends any account that is missing
 * Terms acceptance (of the current version), date of birth, or the other
 * signup answers here. Rules: lib/account-completion.ts.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const sp = await searchParams;
  const next = safeNext(Array.isArray(sp.next) ? sp.next[0] : sp.next);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login`);

  const needs = completionNeeds(user.user_metadata);
  if (!needsCompletion(needs)) redirect(next);

  // Prefill from anything already on file, so an older account confirms rather
  // than retypes.
  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name, sex, primary_sport, date_of_birth")
    .eq("id", user.id)
    .maybeSingle();
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const p = (profile ?? {}) as Record<string, string | null | undefined>;
  const name =
    [p.first_name, p.last_name].filter(Boolean).join(" ") ||
    (typeof meta.full_name === "string" ? meta.full_name : "") ||
    (typeof meta.name === "string" ? meta.name : "");
  const [year, month, day] = (p.date_of_birth ?? "").split("-");

  const short = onlyTermsUpdate(needs);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-5 px-6 py-12">
      <div>
        <p className="font-mono text-[10px] tracking-[0.14em] text-zinc-500 uppercase">
          {short ? "Updated terms" : "One last step"}
        </p>
        <h1 className="font-display mt-1 text-3xl font-bold tracking-wide uppercase">
          {short ? "Our Terms have changed" : "Finish setting up your account"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600">
          {short
            ? "Please review and accept the current Terms of Use to keep using Duravel. The main change: the 7-day free trial now needs a card and becomes a paid plan automatically unless you cancel before it ends."
            : "Before your first session we need a few details and your agreement to our Terms. It takes a minute."}
        </p>
      </div>

      <WelcomeForm
        next={next}
        needs={needs}
        prefill={{
          name,
          sex: p.sex ?? "",
          sport: p.primary_sport ?? "",
          dobMonth: month ?? "",
          dobDay: day ?? "",
          dobYear: year ?? "",
        }}
      />

      <form action={signOut}>
        <button type="submit" className="text-xs text-zinc-500 underline">
          Not you? Sign out
        </button>
      </form>
    </main>
  );
}
