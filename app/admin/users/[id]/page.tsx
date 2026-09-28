import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-access";
import { getAccountActivity, getAccountDetail, type AccountRow } from "@/lib/admin-accounts";
import { auditFor } from "@/lib/admin-audit";
import { billingSnapshot } from "@/lib/admin-billing";
import { accessLabel, formatMoney } from "@/lib/admin-account-rules";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  changeEmail,
  deleteAccount,
  deleteProgram,
  sendPasswordReset,
  setAccess,
  setSuspended,
  stripeCancel,
  stripeEndTrial,
  stripeExtendTrial,
  stripeRefund,
  stripeResume,
  updateProfile,
} from "../actions";
import {
  AdminNav,
  Card,
  Chip,
  ConfirmButton,
  Eyebrow,
  Flash,
  MigrationBanner,
  Row,
  btnCls,
  btnSecondaryCls,
  fmtCalendarDate,
  fmtDate,
  fmtDateTime,
  fmtUnix,
  inputCls,
  labelCls,
  one,
} from "../ui";

export const metadata: Metadata = {
  title: "Account · Admin",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function explainAccess(a: AccountRow): string {
  const billing = explainBilling(a);
  return a.suspended
    ? `Suspended — they can't sign in at all, whatever the rest says. Underneath: ${billing}`
    : billing;
}

function explainBilling(a: AccountRow): string {
  const e = a.access;
  switch (e.source) {
    case "billing_off":
      return "Billing is switched off (BILLING_ENABLED), so every account has full access right now.";
    case "override_revoke":
      return "You revoked access. They can still sign in, but paid features are closed to them whatever they pay.";
    case "override_grant":
      return `Comped at the ${e.tier} tier ${
        a.override?.grant_expires_at
          ? `until ${fmtDate(a.override.grant_expires_at)}`
          : "with no end date"
      }.`;
    case "subscription":
      return `Paying subscriber — ${a.subscription?.plan ?? "plan unknown"}, ${e.tier} tier${
        a.subscription?.cancel_at_period_end ? ", set to cancel at period end" : ""
      }.`;
    case "trial":
      return `On a free trial with a card on file. Stripe charges the card when it ends, ${fmtDateTime(e.trialEndsAt)}, unless they cancel.`;
    case "lapsed":
      return "Had a subscription or trial that is no longer live. They see the two-week preview and the paywall.";
    case "none":
      return "Never checked out — no card, no trial. They see the two-week preview and the paywall, as designed.";
  }
}

export default async function AdminUserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAdmin();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;

  const detail = await getAccountDetail(id);
  if (!detail) notFound();
  const {
    account: a,
    profile,
    subscriptionRow,
    programs,
    eventCount,
    migrationMissing,
    user,
  } = detail;

  const [billing, audit, activity] = await Promise.all([
    billingSnapshot(
      a.email,
      (subscriptionRow?.stripe_customer_id as string | null | undefined) ?? null,
    ),
    auditFor(createAdminClient(), id),
    getAccountActivity(
      id,
      programs.map((p) => p.id),
    ),
  ]);

  const chip = accessLabel(a.access, a.suspended);
  const isSelf = actor.id === a.id;
  const stripeCharging = billing.customers.some((c) =>
    c.subscriptions.some(
      (s) => s.status === "active" || s.status === "trialing" || s.status === "past_due",
    ),
  );
  const ov = a.override;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-6 py-10">
      <AdminNav current="/admin/users" />
      <div>
        <Eyebrow>
          <Link href="/admin" className="hover:text-zinc-800">
            Admin
          </Link>{" "}
          /{" "}
          <Link href="/admin/users" className="hover:text-zinc-800">
            Accounts
          </Link>
        </Eyebrow>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-ink text-3xl font-bold">
            {a.name ?? a.email ?? "Unnamed account"}
          </h1>
          <Chip tone={chip.tone}>{chip.label}</Chip>
          {isSelf ? <Chip tone="blue">You</Chip> : null}
        </div>
        <p className="mt-1 text-sm text-zinc-500">
          {a.email ?? "no email"} · <span className="font-mono text-xs">{a.id}</span> ·{" "}
          <a href={`/admin/users/${a.id}/export`} className="text-accent underline">
            Export all data (JSON)
          </a>
        </p>
      </div>

      <Flash ok={one(sp.ok)} error={one(sp.error)} />
      {migrationMissing ? <MigrationBanner /> : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-4">
          {/* ── Access ─────────────────────────────────────────────── */}
          <Card title="Access">
            <p className="bg-accent-wash mb-4 rounded-lg px-3 py-2.5 text-[13px] leading-relaxed text-zinc-700">
              {explainAccess(a)}
            </p>
            <form action={setAccess} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input type="hidden" name="userId" value={a.id} />
              <fieldset className="sm:col-span-2">
                <legend className={labelCls}>Override</legend>
                <div className="flex flex-wrap gap-4 text-sm">
                  {(
                    [
                      ["default", "Normal rules"],
                      ["grant", "Comp — free access, no card"],
                      ["revoke", "Revoke access"],
                    ] as const
                  ).map(([value, label]) => (
                    <label key={value} className="flex items-center gap-1.5">
                      <input
                        type="radio"
                        name="access"
                        value={value}
                        defaultChecked={(ov?.access ?? "default") === value}
                        disabled={value === "revoke" && isSelf}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div>
                <label htmlFor="tier" className={labelCls}>
                  Tier (when granting)
                </label>
                <select
                  id="tier"
                  name="tier"
                  defaultValue={ov?.grant_tier ?? "standard"}
                  className={inputCls}
                >
                  <option value="standard">Standard</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div>
                <label htmlFor="days" className={labelCls}>
                  Grant for (days — blank = no end)
                </label>
                <input
                  id="days"
                  name="days"
                  type="number"
                  min={1}
                  max={3650}
                  className={inputCls}
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="note" className={labelCls}>
                  Note (why — shown in the audit log)
                </label>
                <input
                  id="note"
                  name="note"
                  defaultValue={""}
                  className={inputCls}
                  placeholder="e.g. founding athlete, comp for bug"
                />
              </div>
              {stripeCharging ? (
                <p className="text-xs leading-relaxed text-amber-800 sm:col-span-2">
                  Stripe is still billing this account. Revoking access does not stop the charges —
                  cancel the subscription under Billing as well.
                </p>
              ) : null}
              <div className="sm:col-span-2">
                <button type="submit" className={btnCls}>
                  Save access
                </button>
              </div>
            </form>
          </Card>

          {/* ── Billing ────────────────────────────────────────────── */}
          <Card title="Billing (Stripe)">
            {!billing.configured ? (
              <p className="text-sm text-zinc-500">
                STRIPE_SECRET_KEY is not set in this environment.
              </p>
            ) : billing.error ? (
              <p className="text-sm text-red-800">Couldn&apos;t reach Stripe: {billing.error}</p>
            ) : billing.customers.length === 0 ? (
              <p className="text-sm text-zinc-500">
                No Stripe customer for this account. They have never checked out.
              </p>
            ) : (
              <div className="flex flex-col gap-5">
                {billing.customers.map((c) => (
                  <div key={c.id}>
                    <div className="mb-2 flex items-baseline justify-between gap-3">
                      <span className="font-mono text-xs text-zinc-500">{c.id}</span>
                      <a
                        href={c.dashboardUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent text-sm underline"
                      >
                        Open in Stripe — change plan here
                      </a>
                    </div>
                    {c.subscriptions.length === 0 ? (
                      <p className="text-sm text-zinc-500">No subscriptions.</p>
                    ) : (
                      c.subscriptions.map((s) => {
                        const live = s.status !== "canceled" && s.status !== "incomplete_expired";
                        return (
                          <div key={s.id} className="mb-3 rounded-lg border border-zinc-200 p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <Chip
                                tone={
                                  s.status === "active" || s.status === "trialing"
                                    ? "green"
                                    : s.status === "past_due"
                                      ? "amber"
                                      : "zinc"
                                }
                              >
                                {s.status}
                              </Chip>
                              {s.cancelAtPeriodEnd ? (
                                <Chip tone="amber">cancels {fmtUnix(s.currentPeriodEnd)}</Chip>
                              ) : null}
                              <span className="text-sm text-zinc-700">
                                {s.items
                                  .map(
                                    (i) =>
                                      `${i.price}${i.amount !== null ? ` · ${formatMoney(i.amount, i.currency)}` : ""}${
                                        i.interval ? `/${i.interval}` : ""
                                      }`,
                                  )
                                  .join(", ")}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-zinc-500">
                              Current period ends {fmtUnix(s.currentPeriodEnd)} ·{" "}
                              <span className="font-mono">{s.id}</span>
                            </p>
                            {s.status === "trialing" ? (
                              <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md bg-amber-50 p-3">
                                <p className="w-full text-xs text-amber-950">
                                  Free trial — the card is charged {fmtUnix(s.trialEnd)} unless they
                                  cancel.
                                </p>
                                <form action={stripeExtendTrial} className="flex items-end gap-2">
                                  <input type="hidden" name="userId" value={a.id} />
                                  <input type="hidden" name="subscriptionId" value={s.id} />
                                  <div>
                                    <label htmlFor={`days-${s.id}`} className={labelCls}>
                                      End trial in (days from today)
                                    </label>
                                    <input
                                      id={`days-${s.id}`}
                                      name="days"
                                      type="number"
                                      min={1}
                                      max={60}
                                      defaultValue={7}
                                      className={`${inputCls} w-24`}
                                    />
                                  </div>
                                  <button type="submit" className={btnSecondaryCls}>
                                    Set trial end
                                  </button>
                                </form>
                                <form action={stripeEndTrial}>
                                  <input type="hidden" name="userId" value={a.id} />
                                  <input type="hidden" name="subscriptionId" value={s.id} />
                                  <ConfirmButton
                                    label="End trial now…"
                                    confirmLabel="Yes — end the trial and charge the card today"
                                    warning="Stripe starts the paid period immediately and charges their card today."
                                  />
                                </form>
                              </div>
                            ) : null}
                            {live ? (
                              <div className="mt-3 flex flex-wrap items-start gap-2">
                                {s.cancelAtPeriodEnd ? (
                                  <form action={stripeResume}>
                                    <input type="hidden" name="userId" value={a.id} />
                                    <input type="hidden" name="subscriptionId" value={s.id} />
                                    <button type="submit" className={btnSecondaryCls}>
                                      Undo scheduled cancel
                                    </button>
                                  </form>
                                ) : (
                                  <form action={stripeCancel}>
                                    <input type="hidden" name="userId" value={a.id} />
                                    <input type="hidden" name="subscriptionId" value={s.id} />
                                    <input type="hidden" name="when" value="period_end" />
                                    <button type="submit" className={btnSecondaryCls}>
                                      Cancel at period end
                                    </button>
                                  </form>
                                )}
                                <form action={stripeCancel}>
                                  <input type="hidden" name="userId" value={a.id} />
                                  <input type="hidden" name="subscriptionId" value={s.id} />
                                  <input type="hidden" name="when" value="now" />
                                  <ConfirmButton
                                    label="Cancel now…"
                                    confirmLabel="Yes, cancel immediately"
                                    warning="Ends the subscription today. Stripe does not refund the unused part of the period automatically — refund a charge below if you owe one."
                                  />
                                </form>
                              </div>
                            ) : null}
                          </div>
                        );
                      })
                    )}
                    {c.charges.length > 0 ? (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-sm text-zinc-600">
                          Recent charges ({c.charges.length})
                        </summary>
                        <ul className="mt-2 flex flex-col gap-2">
                          {c.charges.map((ch) => (
                            <li
                              key={ch.id}
                              className="flex flex-wrap items-start justify-between gap-2 text-sm"
                            >
                              <span>
                                {fmtUnix(ch.created)} · {formatMoney(ch.amount, ch.currency)} ·{" "}
                                {ch.status}
                                {ch.amountRefunded > 0 ? (
                                  <span className="text-zinc-500">
                                    {" "}
                                    · refunded {formatMoney(ch.amountRefunded, ch.currency)}
                                  </span>
                                ) : null}
                              </span>
                              {ch.status === "succeeded" && !ch.refunded ? (
                                <form action={stripeRefund}>
                                  <input type="hidden" name="userId" value={a.id} />
                                  <input type="hidden" name="chargeId" value={ch.id} />
                                  <ConfirmButton
                                    label="Refund…"
                                    confirmLabel={`Refund ${formatMoney(ch.amount - ch.amountRefunded, ch.currency)}`}
                                    warning="Refunds the full remaining amount of this charge. It does not cancel the subscription."
                                  />
                                </form>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
            {subscriptionRow ? (
              <details className="mt-4">
                <summary className="cursor-pointer text-xs text-zinc-500">
                  App&apos;s copy (subscriptions row)
                </summary>
                <RawTable row={subscriptionRow} />
              </details>
            ) : null}
          </Card>

          {/* ── Activity ───────────────────────────────────────────── */}
          <Card title="Activity">
            {activity.summary ? (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(
                    [
                      ["Sessions logged", activity.summary.logged],
                      ["Last 14 days", activity.summary.last14],
                      ["Extra workouts", activity.summary.extras],
                      ["Readiness check-ins", activity.readinessCheckins ?? "—"],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="bg-paper rounded-lg px-3 py-2">
                      <p className="font-mono text-xl font-semibold tabular-nums">{value}</p>
                      <p className="text-xs text-zinc-500">{label}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3">
                  <Row label="Completed · partial · skipped">
                    {activity.summary.completed} · {activity.summary.partial} ·{" "}
                    {activity.summary.skipped}
                  </Row>
                  <Row label="Last session logged">
                    {fmtDateTime(activity.summary.lastLoggedAt)}
                  </Row>
                  <Row label="Last extra workout">{fmtDateTime(activity.summary.lastExtraAt)}</Row>
                  <Row label="Last wearable data (HR/HRV)">
                    {fmtCalendarDate(activity.lastMetricDate)}
                  </Row>
                </div>
              </>
            ) : (
              <p className="text-sm text-zinc-500">Couldn&apos;t read workout logs.</p>
            )}
          </Card>

          {/* ── Programs ───────────────────────────────────────────── */}
          <Card
            title={`Programs (${programs.length})`}
            aside={
              <span className="text-xs text-zinc-500">
                {eventCount} race{eventCount === 1 ? "" : "s"}
              </span>
            }
          >
            {programs.length === 0 ? (
              <p className="text-sm text-zinc-500">No programs yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-zinc-100">
                {programs.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                    <div>
                      <Link
                        href={`/admin/program/${p.id}`}
                        className="text-sm font-medium text-zinc-900 underline"
                      >
                        {p.name ?? "Untitled program"}
                      </Link>
                      <p className="text-xs text-zinc-500">
                        {p.status} · {p.duration_weeks} weeks · starts{" "}
                        {fmtCalendarDate(p.start_date)} · created {fmtDate(p.created_at)}
                      </p>
                    </div>
                    <form action={deleteProgram}>
                      <input type="hidden" name="userId" value={a.id} />
                      <input type="hidden" name="programId" value={p.id} />
                      <ConfirmButton
                        label="Delete…"
                        confirmLabel="Yes, delete program"
                        warning="Removes the program and everything stored against it. This can't be undone."
                      />
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          {/* ── Account ────────────────────────────────────────────── */}
          <Card title="Account">
            <Row label="Signed up">{fmtDateTime(a.createdAt)}</Row>
            <Row label="Last sign-in">{fmtDateTime(a.lastSignInAt)}</Row>
            <Row label="Sign-in method">{a.provider ?? "—"}</Row>
            <Row label="Email confirmed">
              {a.emailConfirmed ? fmtDate(user.email_confirmed_at) : "No"}
            </Row>
            <Row label="Profile row">{a.hasProfile ? "Yes" : "Missing"}</Row>
            <div className="mt-4 flex flex-col gap-3">
              {!isSelf ? (
                <form action={changeEmail} className="flex items-end gap-2">
                  <input type="hidden" name="userId" value={a.id} />
                  <div className="flex-1">
                    <label htmlFor="email" className={labelCls}>
                      Change email
                    </label>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      required
                      defaultValue={a.email ?? ""}
                      className={inputCls}
                    />
                  </div>
                  <button type="submit" className={btnSecondaryCls}>
                    Save
                  </button>
                </form>
              ) : null}
              <form action={sendPasswordReset}>
                <input type="hidden" name="userId" value={a.id} />
                <button type="submit" className={btnSecondaryCls}>
                  Send password reset email
                </button>
              </form>
              {!isSelf ? (
                a.suspended ? (
                  <form action={setSuspended}>
                    <input type="hidden" name="userId" value={a.id} />
                    <input type="hidden" name="suspend" value="false" />
                    <button type="submit" className={btnSecondaryCls}>
                      Restore account
                    </button>
                  </form>
                ) : (
                  <form action={setSuspended}>
                    <input type="hidden" name="userId" value={a.id} />
                    <input type="hidden" name="suspend" value="true" />
                    <ConfirmButton
                      label="Suspend…"
                      confirmLabel="Yes, suspend"
                      warning="Blocks sign-in and keeps all their data. Reversible. A session already open can last up to an hour. Does not stop Stripe billing."
                    />
                  </form>
                )
              ) : null}
            </div>
          </Card>

          {/* ── Profile ────────────────────────────────────────────── */}
          <Card title="Profile">
            <form action={updateProfile} className="flex flex-col gap-3">
              <input type="hidden" name="userId" value={a.id} />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="first_name" className={labelCls}>
                    First name
                  </label>
                  <input
                    id="first_name"
                    name="first_name"
                    defaultValue={(profile?.first_name as string) ?? ""}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label htmlFor="last_name" className={labelCls}>
                    Last name
                  </label>
                  <input
                    id="last_name"
                    name="last_name"
                    defaultValue={(profile?.last_name as string) ?? ""}
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="primary_sport" className={labelCls}>
                  Primary sport
                </label>
                <input
                  id="primary_sport"
                  name="primary_sport"
                  defaultValue={(profile?.primary_sport as string) ?? ""}
                  className={inputCls}
                />
              </div>
              <div>
                <button type="submit" className={btnCls}>
                  {a.hasProfile ? "Save profile" : "Create profile row"}
                </button>
              </div>
            </form>
            {profile ? (
              <details className="mt-4">
                <summary className="cursor-pointer text-xs text-zinc-500">
                  All profile fields
                </summary>
                <RawTable row={profile} />
              </details>
            ) : (
              <p className="mt-3 text-xs leading-relaxed text-zinc-500">
                This account has no profile row. Creating one keeps their trial clock at their
                signup date.
              </p>
            )}
          </Card>

          {/* ── Danger zone ────────────────────────────────────────── */}
          {!isSelf ? (
            <Card title="Delete permanently" tone="danger">
              <form action={deleteAccount} className="flex flex-col gap-2">
                <input type="hidden" name="userId" value={a.id} />
                <p className="text-xs leading-relaxed text-zinc-600">
                  Cancels any Stripe subscription immediately, then deletes the account and the data
                  attached to it. This can&apos;t be undone. To keep their data, suspend instead.
                </p>
                <label htmlFor="confirm" className={labelCls}>
                  Type <span className="font-mono">{a.email}</span> to confirm
                </label>
                <input id="confirm" name="confirm" autoComplete="off" className={inputCls} />
                <div>
                  <button
                    type="submit"
                    className="inline-flex items-center rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800"
                  >
                    Delete account permanently
                  </button>
                </div>
              </form>
            </Card>
          ) : null}

          {/* ── Audit ──────────────────────────────────────────────── */}
          <Card title="Admin history">
            {audit.length === 0 ? (
              <p className="text-sm text-zinc-500">No admin changes yet.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {audit.map((e) => (
                  <li key={e.id} className="text-sm">
                    <span className="font-mono text-xs text-zinc-800">{e.action}</span>
                    <span className="block text-xs text-zinc-500">
                      {fmtDateTime(e.created_at)} · {e.admin_email}
                    </span>
                    {Object.keys(e.detail ?? {}).length > 0 ? (
                      <span className="block font-mono text-[11px] break-all text-zinc-500">
                        {JSON.stringify(e.detail)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </main>
  );
}

function RawTable({ row }: { row: Record<string, unknown> }) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-left text-xs">
        <tbody>
          {Object.entries(row).map(([k, v]) => (
            <tr key={k} className="border-b border-zinc-100 last:border-0">
              <td className="py-1 pr-3 align-top font-mono text-zinc-500">{k}</td>
              <td className="py-1 font-mono break-all text-zinc-800">
                {v === null ? (
                  <span className="text-zinc-400">null</span>
                ) : typeof v === "object" ? (
                  JSON.stringify(v)
                ) : (
                  String(v)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
