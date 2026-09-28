import Link from "next/link";
import { getActiveAnnouncement } from "@/lib/site-announcement";
import AnnouncementDismiss from "./site-announcement-dismiss";

/**
 * The strip under the nav for signed-in athletes. Rendered by NavBar only when
 * there is a user, so it costs no extra sign-in lookup. Server component; the
 * only client code is the dismiss button.
 */
export default async function SiteAnnouncement() {
  const a = await getActiveAnnouncement();
  if (!a) return null;
  const warning = a.tone === "warning";
  const internal = a.link_url?.startsWith("/");
  return (
    <AnnouncementDismiss id={a.id}>
      <div
        role={warning ? "alert" : "status"}
        className={`border-t text-sm ${warning ? "border-amber-200 bg-amber-50 text-amber-950" : "border-line bg-accent-wash text-zinc-800"}`}
      >
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-2">
          <p className="flex-1 leading-snug">
            {a.message}
            {a.link_url ? (
              <>
                {" "}
                {internal ? (
                  <Link href={a.link_url} className="font-medium underline">
                    {a.link_label || "Learn more"}
                  </Link>
                ) : (
                  <a
                    href={a.link_url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium underline"
                  >
                    {a.link_label || "Learn more"}
                  </a>
                )}
              </>
            ) : null}
          </p>
        </div>
      </div>
    </AnnouncementDismiss>
  );
}
