import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdmin } from "@/lib/admin";
import { getFundraiser } from "@/lib/fundraiser-data";
import { centsToUsd } from "@/lib/fundraiser";
import FundraiserEditor from "@/components/admin/fundraiser-editor";

/** Admin fundraiser editor page (#19). */
export const dynamic = "force-dynamic";

export default async function AdminImpactPage() {
  const admin = await getAdmin();
  if (!admin) notFound();

  const f = await getFundraiser();

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-12">
      <div className="flex flex-col gap-1">
        <Link href="/admin" className="text-sm text-zinc-500 underline">
          ← Admin
        </Link>
        <h1 className="text-2xl font-semibold">Race for Impact tracker</h1>
        <p className="text-sm text-zinc-500">
          Update as donations come in. The public page is at{" "}
          <Link href="/impact" className="underline">
            /impact
          </Link>{" "}
          — link it from your Instagram bio.
        </p>
      </div>

      <section className="rounded-2xl border border-zinc-200 p-5">
        <FundraiserEditor
          initial={{
            title: f?.title ?? "Race for Impact",
            tagline: f?.tagline ?? "",
            donateUrl: f?.donate_url ?? "",
            goalDollars: f ? String(centsToUsd(f.goal_cents)) : "",
            raisedDollars: f ? String(centsToUsd(f.raised_cents)) : "",
          }}
        />
      </section>
    </main>
  );
}
