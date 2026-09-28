import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-access";
import { createAccount } from "../actions";
import { AdminNav, Card, Eyebrow, Flash, btnCls, inputCls, labelCls, one } from "../ui";

export const metadata: Metadata = {
  title: "Add account · Admin",
  robots: { index: false, follow: false },
};

/**
 * Create an account by hand (2026-09-28). The action is `createAccount`; the
 * rules are `parseNewAccount` in lib/admin-account-rules.ts.
 */
export default async function NewAccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-10">
      <AdminNav current="/admin/users" />
      <div>
        <Eyebrow>
          <Link href="/admin" className="hover:text-zinc-800">
            Admin
          </Link>{" "}
          /{" "}
          <Link href="/admin/users" className="hover:text-zinc-800">
            Accounts
          </Link>{" "}
          / Add
        </Eyebrow>
        <h1 className="font-display text-ink mt-1 text-3xl font-bold">Add an account</h1>
      </div>

      <Flash error={one(sp.error)} />

      <form action={createAccount} className="flex flex-col gap-5">
        <Card title="Who">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="new-email" className={labelCls}>
                Email
              </label>
              <input
                id="new-email"
                name="email"
                type="email"
                required
                autoComplete="off"
                placeholder="name@example.com"
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="new-first" className={labelCls}>
                First name (optional)
              </label>
              <input id="new-first" name="firstName" autoComplete="off" className={inputCls} />
            </div>
            <div>
              <label htmlFor="new-last" className={labelCls}>
                Last name (optional)
              </label>
              <input id="new-last" name="lastName" autoComplete="off" className={inputCls} />
            </div>
          </div>
        </Card>

        <Card title="How they get in">
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="sr-only">How they get in</legend>
            {(
              [
                [
                  "set_password",
                  "Create it now and email them a link to set a password",
                  'Recommended. The account is confirmed immediately; the email is the same one "Forgot password" sends.',
                ],
                [
                  "invite",
                  "Send Supabase's invitation email",
                  "The account stays unconfirmed until they click the link.",
                ],
                [
                  "none",
                  "Create it now and send nothing",
                  'They can sign in with Google on this address, or use "Forgot password" when they\'re ready.',
                ],
              ] as const
            ).map(([value, label, hint]) => (
              <label key={value} className="flex items-start gap-2">
                <input
                  type="radio"
                  name="onboarding"
                  value={value}
                  defaultChecked={value === "set_password"}
                  className="mt-1"
                />
                <span>
                  <span className="text-zinc-900">{label}</span>
                  <span className="block text-xs text-zinc-500">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </Card>

        <Card title="Access">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <fieldset className="sm:col-span-2">
              <legend className={labelCls}>Starting access</legend>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="access" value="default" defaultChecked />
                  Normal rules (paywall; 7-day trial when they add a card)
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="access" value="grant" />
                  Comp — free access, no card
                </label>
              </div>
            </fieldset>
            <div>
              <label htmlFor="new-tier" className={labelCls}>
                Comp tier
              </label>
              <select id="new-tier" name="tier" defaultValue="standard" className={inputCls}>
                <option value="standard">Standard</option>
                <option value="custom">Custom program</option>
              </select>
            </div>
            <div>
              <label htmlFor="new-days" className={labelCls}>
                Comp length in days (blank = no end)
              </label>
              <input
                id="new-days"
                name="days"
                inputMode="numeric"
                placeholder="30"
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="new-note" className={labelCls}>
                Note (why — kept in the audit log)
              </label>
              <input id="new-note" name="note" className={inputCls} />
            </div>
          </div>
        </Card>

        <p className="text-xs leading-relaxed text-zinc-500">
          An account made here skips the signup page, so on their first sign-in they are asked for
          their date of birth, sex, sport and a password, and must accept the Terms before they can
          use the app. The audit log records that you created it.
        </p>

        <div>
          <button type="submit" className={btnCls}>
            Create account
          </button>
        </div>
      </form>
    </main>
  );
}
