import { NextRequest, NextResponse } from "next/server";
import { orIlike, safeLike } from "@/lib/pgrst";
import { getPlatformStaff } from "@/lib/platform";
import { platformCanAccess } from "@/lib/platform-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { ALL_SETTING_DEFS } from "@/lib/settings/registry";
import { searchSettings } from "@/lib/settings/view";
import { SETTING_CATEGORIES } from "@/lib/settings/types";
import { INVOICE_STATUS_LABELS } from "@/lib/accounting/ledger";

export type SearchHit = {
  id: string;
  type: "tenant" | "member" | "ticket" | "setting" | "invoice";
  title: string;
  subtitle: string;
  href: string;
};

type Admin = ReturnType<typeof createAdminClient>;

const tryFmt = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);

/** e-posta için ilike deseni: yalnız LIKE jokerleri temizlenir (nokta/@ korunur; tek filtre, `or` grameri yok). */
function emailLike(raw: string): string {
  return `%${raw.slice(0, 80).replace(/[%_\\*"(),]/g, "").trim()}%`;
}

/**
 * Fatura araması (billing modülü): fatura no + ofis adı + ofis kullanıcısının e-postası. Ofis/e-posta eşleşmesi o
 * ofislerin en yeni faturalarını getirir. Sorgular bağımsız turlarda paralel; en çok 8 sonuç.
 */
async function searchInvoices(admin: Admin, q: string): Promise<SearchHit[]> {
  const like = safeLike(q);
  const select = "id, invoice_no, status, total_try, created_at, tenant:tenants(name)";
  const [byNo, tenantsByName, profilesByEmail] = await Promise.all([
    admin.from("invoices").select(select).ilike("invoice_no", like).order("created_at", { ascending: false }).limit(5),
    admin.from("tenants").select("id").ilike("name", like).limit(5),
    q.includes("@") ? admin.from("profiles").select("tenant_id").ilike("email", emailLike(q)).not("tenant_id", "is", null).limit(5) : Promise.resolve({ data: [] as { tenant_id: string | null }[] }),
  ]);
  const tenantIds = [
    ...new Set([
      ...((tenantsByName.data ?? []) as { id: string }[]).map((t) => String(t.id)),
      ...((profilesByEmail.data ?? []) as { tenant_id: string | null }[]).flatMap((p) => (p.tenant_id ? [String(p.tenant_id)] : [])),
    ]),
  ];
  const byTenant = tenantIds.length
    ? await admin.from("invoices").select(select).in("tenant_id", tenantIds).order("created_at", { ascending: false }).limit(6)
    : { data: [] };
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const r of [...(byNo.data ?? []), ...(byTenant.data ?? [])] as { id: string; invoice_no: string; status: string; total_try: number; tenant: { name?: string } | { name?: string }[] | null }[]) {
    if (seen.has(r.id) || out.length >= 8) continue;
    seen.add(r.id);
    const t = Array.isArray(r.tenant) ? r.tenant[0] : r.tenant;
    out.push({
      id: `invoice:${r.id}`,
      type: "invoice",
      title: r.invoice_no,
      subtitle: `${t?.name ?? "Ofis"} · ${INVOICE_STATUS_LABELS[r.status] ?? r.status} · ${tryFmt(Number(r.total_try ?? 0))}`,
      href: `/admin/billing/faturalar/${r.id}`,
    });
  }
  return out;
}

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

  if (platformCanAccess(staff, "tenants")) {
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

  if (platformCanAccess(staff, "members")) {
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

  if (platformCanAccess(staff, "tickets")) {
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

  if (platformCanAccess(staff, "billing")) {
    tasks.push(
      searchInvoices(admin, q)
        .then((found) => {
          hits.push(...found);
        })
        .catch(() => undefined),
    );
  }

  // Ayarlar (Sistem Ayarları Merkezi): registry indeksinden, rol filtreli (modül "sistem"); gizli ayarlarda değer YOK.
  if (platformCanAccess(staff, "sistem")) {
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
