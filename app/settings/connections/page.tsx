import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { env, envFlag } from "@/lib/env";
import { getConnectionStatuses } from "@/lib/wearables/connections";
import ConnectionsPanel from "@/components/settings/connections-panel";
import StravaAutopostToggle from "@/components/settings/strava-autopost-toggle";
import PushToggle from "@/components/settings/push-toggle";

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

  // `timezone` rides along on the profile read the page already needs. Last-sync
  // timestamps are INSTANTS: formatting them with the ambient zone renders one
  // string on the server and another in the browser (React #418). See
  // `formatInstant`.
  const { data: prof } = await supabase
    .from("profiles")
    .select("strava_autopost, timezone")
    .eq("id", user.id)
    .maybeSingle();
  const timeZone = (prof?.timezone as string | null) ?? null;

  const stravaWrite = envFlag(env.STRAVA_WRITE_ENABLED) && !!env.STRAVA_CLIENT_ID;
  const stravaAutopost = stravaWrite ? (prof?.strava_autopost ?? true) : true;

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
        ouraConfigured={!!env.OURA_CLIENT_ID}
        flashConnected={sp.connected ?? null}
        flashError={sp.error ?? null}
        timeZone={timeZone}
      />

      {stravaWrite && <StravaAutopostToggle initial={stravaAutopost} />}

      {env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && (
        <PushToggle vapidPublicKey={env.NEXT_PUBLIC_VAPID_PUBLIC_KEY} />
      )}

      <Link href="/settings" className="text-sm underline">
        Back to settings
      </Link>
    </main>
  );
}
