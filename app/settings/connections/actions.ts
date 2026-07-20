"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { deleteConnection } from "@/lib/wearables/connections";
import { WEARABLE_PROVIDERS, type WearableProvider } from "@/lib/wearables/types";

/**
 * Disconnect a wearable (removes the stored OAuth connection). Used as a form
 * action from the connections panel. Deletion goes through the service-role
 * client (deleteConnection), scoped to the signed-in user.
 */
export async function disconnectProvider(formData: FormData) {
  const provider = formData.get("provider");
  if (typeof provider !== "string" || !WEARABLE_PROVIDERS.includes(provider as WearableProvider)) {
    return;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await deleteConnection(user.id, provider as WearableProvider);
  revalidatePath("/settings/connections");
}
