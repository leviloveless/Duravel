import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-access";
import { listAccounts } from "@/lib/admin-accounts";
import {
  ACCOUNT_FILTERS,
  accessLabel,
  matchesFilter,
  matchesQuery,
  parseFilter,
  type AccountFilter,
} from "@/lib/admin-account-rules";
import { deleteAccounts } from "./actions";
import { BULK_DELETE_MAX, BULK_DELETE_WORD } from "@/lib/admin-account-rules";
import {
  AdminNav,
  Chip,
  Eyebrow,
  Flash,
  MigrationBanner,
  btnCls,
  btnDangerCls,
  fmtDate,
  fmtDateTime,
  inputCls,
  one,
} from "./ui";

export const metadata: Metadata = {
  title: "Accounts · Admin",
  robots: { index: false, follow: false },
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const q = one(sp.q) ?? "";
  const filter = parseFilter(one(sp.filter));

  const { accounts, migrationMissing, capped } = await listAccounts();
  const counts = new Map<AccountFilter, number>(
    ACCOUNT_FILTERS.map((f) => [f.key, accounts.filter((a) => matchesFilter(a, f.key)).length]),
  );
  const shown = accounts.filter((a) => matchesFilter(a, filter) && matchesQuery(a, q));

  const csvParams = new URLSearchParams();
  if (q) csvParams.set("q", q);
  if (filter !== "all") csvParams.set("filter", filter);
  const csvQuery = csvParams.toString() ? `?${csvParams.toString()}` : "";

  const hrefFor = (f: AccountFilter) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (f !== "all") params.set("filter", f);
    const s = params.toString();
    return `/admin/users${s ? `?${s}` : ""}`;
  };

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-6 py-10">
      <AdminNav current="/admin/users" />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>
            <Link href="/admin" className="hover:text-zinc-800">
              Admin
            </Link>{" "}
            / Accounts
          </Eyebrow>
          <h1 className="font-display text-ink mt-1 text-3xl font-bold">Accounts</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {accounts.length} account{accounts.length === 1 ? "" : "s"}
            {capped ? " — showing the first 10,000" : ""} ·{" "}
            <a href={`/admin/users/csv${csvQuery}`} className="text-accent underline">
              Download {filter === "all" && !q ? "all" : "these"} as CSV
            </a>
          </p>
        </div>
        <Link href="/admin/users/new" className={btnCls}>
          Add account
        </Link>
      </div>

      <Flash
        ok={one(sp.ok)}
        error={one(sp.error)}
        detail={one(sp.ok) === "bulk_deleted" ? one(sp.detail) : undefined}
      />
      {migrationMissing ? <MigrationBanner /> : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Filter accounts" className="flex flex-wrap gap-1.5">
          {ACCOUNT_FILTERS.map((f) => {
            const active = f.key === filter;
            return (
              <Link
                key={f.key}
                href={hrefFor(f.key)}
                aria-current={active ? "page" : undefined}
                className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${
                  active
                    ? "bg-ink text-white ring-ink"
                    : "bg-white text-zinc-700 ring-line hover:bg-zinc-50"
                }`}
              >
                {f.label}{" "}
                <span className={active ? "text-zinc-300" : "text-zinc-400"}>
                  {counts.get(f.key) ?? 0}
                </span>
              </Link>
            );
          })}
        </nav>
        <form method="get" action="/admin/users" className="flex gap-2">
          {filter !== "all" ? <input type="hidden" name="filter" value={filter} /> : null}
          <input
            name="q"
            defaultValue={q}
            placeholder="Search email, name or id"
            aria-label="Search accounts"
            className={`${inputCls} sm:w-64`}
          />
        </form>
      </div>

      <form action={deleteAccounts} className="flex flex-col gap-3">
        <div className="border-line overflow-x-auto rounded-xl border bg-white">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-line bg-paper border-b text-xs text-zinc-500">
              <tr>
                <th className="w-10 px-4 py-2.5 font-medium">
                  <span className="sr-only">Select</span>
                </th>
                <th className="px-4 py-2.5 font-medium">Account</th>
                <th className="px-4 py-2.5 font-medium">Access</th>
                <th className="px-4 py-2.5 font-medium">Signed up</th>
                <th className="px-4 py-2.5 font-medium">Last sign-in</th>
                <th className="px-4 py-2.5 text-right font-medium">Programs</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-zinc-500">
                    No accounts match.
                  </td>
                </tr>
              ) : (
                shown.map((a) => {
                  const chip = accessLabel(a.access, a.suspended);
                  return (
                    <tr
                      key={a.id}
                      className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50"
                    >
                      <td className="px-4 py-2.5 align-top">
                        <input
                          type="checkbox"
                          name="userId"
                          value={a.id}
                          aria-label={`Select ${a.email ?? a.id}`}
                          className="mt-1 h-4 w-4 accent-red-700"
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <Link href={`/admin/users/${a.id}`} className="block">
                          <span className="font-medium text-zinc-900">
                            {a.name ?? a.email ?? a.id}
                          </span>
                          {a.name ? (
                            <span className="block text-xs text-zinc-500">{a.email}</span>
                          ) : null}
                          <span className="mt-0.5 flex gap-1.5">
                            {!a.hasProfile ? <Chip tone="amber">No profile</Chip> : null}
                            {!a.emailConfirmed ? <Chip tone="zinc">Unconfirmed</Chip> : null}
                          </span>
                        </Link>
                      </td>
                      <td className="px-4 py-2.5">
                        <Chip tone={chip.tone}>{chip.label}</Chip>
                        {a.access.entitled && a.access.tier === "custom" ? (
                          <span className="ml-1.5 text-xs text-zinc-500">custom</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-zinc-700">
                        {fmtDate(a.createdAt)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-zinc-700">
                        {fmtDateTime(a.lastSignInAt)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-zinc-700 tabular-nums">
                        {a.programCount}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <details className="group self-start">
          <summary className="inline-flex cursor-pointer list-none items-center rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 [&::-webkit-details-marker]:hidden">
            Delete selected…
          </summary>
          <div className="mt-2 flex max-w-xl flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-3">
            <p className="text-xs leading-relaxed text-red-900">
              Permanently deletes every ticked account and all of its data — programs, logs,
              connections. This cannot be undone. Accounts with a live Stripe subscription are
              skipped: cancel those on the account&apos;s own page first. Your own account is never
              deleted. Up to {BULK_DELETE_MAX} at a time.
            </p>
            <label className="text-xs font-medium text-red-900" htmlFor="bulk-confirm">
              Type {BULK_DELETE_WORD} to confirm
            </label>
            <div className="flex gap-2">
              <input
                id="bulk-confirm"
                name="confirm"
                autoComplete="off"
                className={`${inputCls} max-w-[10rem]`}
              />
              <button type="submit" className={btnDangerCls}>
                Delete selected accounts
              </button>
            </div>
          </div>
        </details>
      </form>
    </main>
  );
}
