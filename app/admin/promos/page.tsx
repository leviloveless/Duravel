import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-access";
import { listPromos } from "@/lib/admin-promos";
import { createPromoCode, togglePromo } from "./actions";
import {
  AdminNav,
  Card,
  Chip,
  Eyebrow,
  Flash,
  btnCls,
  btnSecondaryCls,
  fmtUnix,
  inputCls,
  labelCls,
  one,
} from "../users/ui";

export const metadata: Metadata = {
  title: "Promo codes · Admin",
  robots: { index: false, follow: false },
};

export default async function PromosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const { configured, promos, error } = await listPromos();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-6 py-10">
      <AdminNav current="/admin/promos" />
      <div>
        <Eyebrow>Admin</Eyebrow>
        <h1 className="font-display text-ink mt-1 text-3xl font-bold">Promo codes</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600">
          Codes athletes type at checkout. Each code gets its own Stripe coupon, so turning one off
          never affects another.
        </p>
      </div>
      <Flash ok={one(sp.ok)} error={one(sp.error)} />

      <Card title="New code">
        {!configured ? (
          <p className="text-sm text-zinc-500">STRIPE_SECRET_KEY is not set in this environment.</p>
        ) : (
          <form action={createPromoCode} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="code" className={labelCls}>
                Code
              </label>
              <input
                id="code"
                name="code"
                required
                placeholder="GYM20"
                className={`${inputCls} font-mono uppercase`}
              />
            </div>
            <div>
              <label htmlFor="percent_off" className={labelCls}>
                Percent off
              </label>
              <input
                id="percent_off"
                name="percent_off"
                type="number"
                min={1}
                max={100}
                step="any"
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="amount_off" className={labelCls}>
                …or dollars off
              </label>
              <input
                id="amount_off"
                name="amount_off"
                type="number"
                min={0.01}
                step="0.01"
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="duration" className={labelCls}>
                Applies to
              </label>
              <select id="duration" name="duration" defaultValue="once" className={inputCls}>
                <option value="once">First payment only</option>
                <option value="repeating">Several months</option>
                <option value="forever">Every payment</option>
              </select>
            </div>
            <div>
              <label htmlFor="months" className={labelCls}>
                Months (if several)
              </label>
              <input
                id="months"
                name="months"
                type="number"
                min={1}
                max={36}
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="max_redemptions" className={labelCls}>
                Max uses (blank = unlimited)
              </label>
              <input
                id="max_redemptions"
                name="max_redemptions"
                type="number"
                min={1}
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="expires_days" className={labelCls}>
                Expires in (days, blank = never)
              </label>
              <input
                id="expires_days"
                name="expires_days"
                type="number"
                min={1}
                max={3650}
                className={inputCls}
              />
            </div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-zinc-700 sm:col-span-2">
              <input type="checkbox" name="first_time_only" /> First-time customers only
            </label>
            <div className="sm:col-span-3">
              <button type="submit" className={btnCls}>
                Create in Stripe
              </button>
            </div>
          </form>
        )}
      </Card>

      <Card title={`Codes (${promos.length})`}>
        {error ? (
          <p className="text-sm text-red-800">Couldn&apos;t reach Stripe: {error}</p>
        ) : promos.length === 0 ? (
          <p className="text-sm text-zinc-500">No promo codes yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs text-zinc-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">Code</th>
                  <th className="py-2 pr-4 font-medium">Discount</th>
                  <th className="py-2 pr-4 font-medium">Used</th>
                  <th className="py-2 pr-4 font-medium">Expires</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {promos.map((p) => (
                  <tr key={p.id} className="border-t border-zinc-100">
                    <td className="py-2 pr-4">
                      <span className="font-mono font-medium">{p.code}</span>{" "}
                      {p.active ? <Chip tone="green">active</Chip> : <Chip tone="zinc">off</Chip>}
                      {p.firstTimeOnly ? (
                        <span className="ml-1 text-xs text-zinc-500">first-time</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-4">{p.discount}</td>
                    <td className="py-2 pr-4 tabular-nums">
                      {p.timesRedeemed}
                      {p.maxRedemptions ? ` / ${p.maxRedemptions}` : ""}
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {p.expiresAt ? fmtUnix(p.expiresAt) : "Never"}
                    </td>
                    <td className="py-2 text-right">
                      <form action={togglePromo}>
                        <input type="hidden" name="promoId" value={p.id} />
                        <input type="hidden" name="active" value={p.active ? "false" : "true"} />
                        <button type="submit" className={btnSecondaryCls}>
                          {p.active ? "Turn off" : "Turn on"}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </main>
  );
}
