import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const admin = createClient(url, service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const email = `smoke+${Date.now()}@emlaksoft.test`;
  const slug = `smoke-${Date.now()}`;

  const { data: tenant, error: te } = await admin
    .from("tenants")
    .insert({
      name: "Smoke Ofis",
      slug,
      plan: "office",
      status: "trial",
      trial_ends_at: new Date(Date.now() + 14 * 864e5).toISOString(),
    })
    .select("id")
    .single();
  if (te) throw te;

  const { data: created, error: ue } = await admin.auth.admin.createUser({
    email,
    password: "Test1234!",
    email_confirm: true,
    app_metadata: { tenant_id: tenant.id, role: "owner" },
    user_metadata: { full_name: "Smoke Test" },
  });
  if (ue || !created.user) throw ue ?? new Error("no user");

  const { error: pe } = await admin.from("profiles").insert({
    id: created.user.id,
    tenant_id: tenant.id,
    full_name: "Smoke Test",
    role: "owner",
  });
  if (pe) throw pe;

  const anon = createClient(url, anonKey);
  const { data: sess, error: se } = await anon.auth.signInWithPassword({
    email,
    password: "Test1234!",
  });
  if (se) throw se;

  console.log("SMOKE-OK", {
    tenant: tenant.id,
    user: created.user.id,
    hasSession: Boolean(sess.session),
  });

  await admin.from("profiles").delete().eq("id", created.user.id);
  await admin.auth.admin.deleteUser(created.user.id);
  await admin.from("tenants").delete().eq("id", tenant.id);
  console.log("cleaned");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
