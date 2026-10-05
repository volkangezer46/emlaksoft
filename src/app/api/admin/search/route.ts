import { NextRequest, NextResponse } from "next/server";
import { orIlike, safeLike } from "@/lib/pgrst";
import { getPlatformStaff } from "@/lib/platform";
import { platformCanAccess } from "@/lib/platform-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { ALL_SETTING_DEFS } from "@/lib/settings/registry";
import { searchSettings } from "@/lib/settings/view";
import { SETTING_CATEGORIES } from "@/lib/settings/types";

export type SearchHit = {
  id: string;
  type: "tenant" | "member" | "ticket" | "setting";
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
  const q = rawQ.slice(0, 80);
  if (q.trim().length < 2) return NextResponse.json({ hits: [] });

  const admin = createAdminClient();
  // Onceden `%` ve `_` temizlenmiyordu: `%` yazan kullanici tum kayitlari cekiyordu.
  const like = safeLike(q);
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
        .or(orIlike(["full_name", "email"], q))
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

  // Ayarlar (Sistem Ayarları Merkezi): registry indeksinden, rol filtreli (modül "sistem"); gizli ayarlarda değer YOK.
  if (platformCanAccess(staff.role, "sistem")) {
    for (const h of searchSettings(ALL_SETTING_DEFS.filter((d) => d.scope === "platform"), q, 5)) {
      hits.push({
        id: `setting:${h.key}`,
        type: "setting",
        title: h.label,
        subtitle: SETTING_CATEGORIES.find((c) => c.id === h.category)?.label ?? "Ayar",
        href: h.href,
      });
    }
  }

  await Promise.all(tasks);
  return NextResponse.json({ hits });
}
