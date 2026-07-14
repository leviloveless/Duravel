import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { getConnectionStatuses } from "@/lib/wearables/connections";
import ConnectionsPanel from "@/components/settings/connections-panel";

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [statuses, sp] = await Promise.all([getConnectionStatuses(user.id), searchParams]);

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 px-6 py-16">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Connections</h1>
        <p className="text-sm text-zinc-500">
          Connect a wearable so your runs and recovery flow in automatically — no manual logging.
        </p>
      </div>

      <ConnectionsPanel
        statuses={statuses}
        stravaConfigured={!!env.STRAVA_CLIENT_ID}
        flashConnected={sp.connected ?? null}
        flashError={sp.error ?? null}
      />

      <Link href="/settings" className="text-sm underline">
        Back to settings
      </Link>
    </main>
  );
}
