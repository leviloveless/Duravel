import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { completionNeeds, isGatedPath, needsCompletion } from "@/lib/account-completion";

/**
 * Refreshes the Supabase auth session on every request and keeps the
 * browser + server cookie jars in sync. Called from middleware.ts.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Touch the session so expired tokens get refreshed before any
  // Server Component reads it. Do not remove — required by @supabase/ssr.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // First-login step (2026-09-28): an account missing Terms acceptance, date of
  // birth or the other signup answers goes to /welcome before the app. Page
  // navigations only (GET) — never a server action, an API call or a webhook.
  // Decided from metadata `getUser()` already returned, so it costs no query.
  // See lib/account-completion.ts.
  const { pathname, search } = request.nextUrl;
  if (
    user &&
    request.method === "GET" &&
    isGatedPath(pathname) &&
    needsCompletion(completionNeeds(user.user_metadata))
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/welcome";
    url.search = `?next=${encodeURIComponent(`${pathname}${search}`)}`;
    const redirect = NextResponse.redirect(url);
    // Carry any refreshed session cookies across the redirect.
    supabaseResponse.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }

  return supabaseResponse;
}
