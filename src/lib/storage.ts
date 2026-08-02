import { supabase } from "./supabase";

// Collection identifiers (stored in the "collection_name" text column).
export const HISTORY_KEY = "espresso-dial-history";
export const BAGS_KEY = "espresso-dial-bags";
export const PROFILE_KEY = "espresso-dial-equipment-profile";

// Table holding each collection as a single JSON array row per user.
// Columns: id (bigint, generated), user_id (uuid), collection_name (text), data (jsonb)
// Unique constraint on (user_id, collection_name) enables upsert.
const TABLE = "collections";

async function getUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function loadCollection<T>(key: string): Promise<T[]> {
  const userId = await getUserId();
  if (!userId) return [];
  const { data, error } = await supabase
    .from(TABLE)
    .select("data")
    .eq("user_id", userId)
    .eq("collection_name", key)
    .maybeSingle();
  if (error) {
    console.error("[v0] loadCollection error:", error.message);
    return [];
  }
  return (data?.data as T[]) ?? [];
}

export async function saveCollection<T>(key: string, value: T[]): Promise<void> {
  const userId = await getUserId();
  if (!userId) return;
  const { error } = await supabase
    .from(TABLE)
    .upsert(
      { user_id: userId, collection_name: key, data: value },
      { onConflict: "user_id,collection_name" }
    );
  if (error) {
    console.error("[v0] saveCollection error:", error.message);
  }
}
