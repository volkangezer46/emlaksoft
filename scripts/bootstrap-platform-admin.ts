/**
 * Bootstrap first platform staff from an existing auth user email.
 * Usage: npx tsx scripts/bootstrap-platform-admin.ts you@email.com
 */
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!email) {
  console.error("usage: npx tsx scripts/bootstrap-platform-admin.ts <email>");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  const { data: listed, error: listErr } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (listErr) throw listErr;
  const user = listed.users.find((u) => u.email?.toLowerCase() === email);
  if (!user) {
    console.error("User not found in auth.users:", email);
    process.exit(1);
  }

  const fullName =
    (user.user_metadata?.full_name as string | undefined) ??
    email.split("@")[0] ??
    "Platform Admin";

  const { error } = await admin.from("platform_staff").upsert({
    id: user.id,
    email,
    full_name: fullName,
    role: "super_admin",
    is_active: true,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;

  console.log("OK platform_staff:", email, user.id, "super_admin");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
