import { NextRequest, NextResponse } from "next/server";
import { getPlatformStaff } from "@/lib/platform";
import { platformCanAccess } from "@/lib/platform-access";
import { createAdminClient } from "@/lib/supabase/admin";

export type SearchHit = {
  id: string;
  type: "tenant" | "member" | "ticket";
  title: string;
  subtitle: string;
  href: string;
};

/** Platform genel arama — komut paleti (Ctrl+K) besler. Role göre kapsam sınırlıdır. */
export async function GET(req: NextRequest) {
  const staff = await getPlatformStaff();
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rawQ = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (rawQ.length < 2) return NextResponse.json({ hits: [] });

  // PostgREST .or() filter injection koruması: gramer karakterlerini (, ) . * : soyutla
  const q = rawQ.slice(0, 80).replace(/[(),.*:\\]/g, " ");
  if (q.trim().length < 2) return NextResponse.json({ hits: [] });

  const admin = createAdminClient();
  const like = `%${q}%`;
  const hits: SearchHit[] = [];

  const tasks: PromiseLike<void>[] = [];

  if (platformCanAccess(staff.role, "tenants")) {
    tasks.push(
      admin
        .from("tenants")
        .select("id, name, plan, status")
        .ilike("name", like)
        .limit(6)
        .then(({ data }) => {
          for (const t of data ?? []) {
            hits.push({
              id: t.id,
              type: "tenant",
              title: t.name,
              subtitle: `${t.plan ?? "—"} · ${t.status ?? "—"}`,
              href: `/admin/tenants/${t.id}`,
            });
          }
        }),
    );
  }

  if (platformCanAccess(staff.role, "members")) {
    tasks.push(
      admin
        .from("profiles")
        .select("id, full_name, email, role")
        .or(`full_name.ilike.${like},email.ilike.${like}`)
        .limit(6)
        .then(({ data }) => {
          for (const m of data ?? []) {
            hits.push({
              id: m.id,
              type: "member",
              title: m.full_name || m.email || "Kullanıcı",
              subtitle: `${m.email ?? ""} · ${m.role ?? ""}`.trim(),
              href: `/admin/members`,
            });
          }
        }),
    );
  }

  if (platformCanAccess(staff.role, "tickets")) {
    tasks.push(
      admin
        .from("support_tickets")
        .select("id, subject, status, priority")
        .ilike("subject", like)
        .limit(6)
        .then(({ data }) => {
          for (const t of data ?? []) {
            hits.push({
              id: t.id,
              type: "ticket",
              title: t.subject,
              subtitle: `${t.status ?? ""} · ${t.priority ?? ""}`.trim(),
              href: `/admin/tickets/${t.id}`,
            });
          }
        }),
    );
  }

  await Promise.all(tasks);
  return NextResponse.json({ hits });
}
