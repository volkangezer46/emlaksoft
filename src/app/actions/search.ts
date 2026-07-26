"use server";

import { createClient } from "@/lib/supabase/server";
import { orIlike, safeLike } from "@/lib/pgrst";
import { requireActiveTenant } from "@/lib/tenant-guard";
import { formatTurkishPhone } from "@/lib/phone";

export type SearchHit = {
  id: string;
  kind: "customer" | "property" | "demand" | "deal" | "task" | "ticket";
  title: string;
  subtitle: string;
  href: string;
};

const DEAL_STAGE_LABEL: Record<string, string> = {
  new: "Yeni",
  qualified: "Nitelikli",
  negotiation: "Müzakere",
  won: "Kazanıldı",
  lost: "Kaybedildi",
};

const TASK_KIND_LABEL: Record<string, string> = {
  call: "Arama",
  visit: "Ziyaret",
  document: "Evrak",
  followup: "Takip",
};

type DealHitRow = {
  id: string;
  stage: string;
  deal_type: string;
  deal_value: number | string | null;
  customer: { full_name?: string | null } | { full_name?: string | null }[] | null;
  property:
    | { title?: string | null; property_code?: string | null }
    | { title?: string | null; property_code?: string | null }[]
    | null;
};

/**
 * Çalışma alanı araması. `limit` opsiyonel: komut paleti varsayılanı (20) korunur;
 * /app/arama-sonuclari sayfası daha yüksek limitle çağırır. Tablo başına alt
 * limitler toplam limitle orantılı büyütülür (faktör), sonuç yine `limit` ile kırpılır.
 */
export async function searchWorkspace(query: string, limit: number = 20): Promise<SearchHit[]> {
  const gate = await requireActiveTenant();
  if (!gate.ok) return [];

  const q = query.trim();
  if (q.length < 2) return [];

  const supabase = await createClient();
  // Temizleme artik ortak yardimcida: onceden `%` ve `_` birakiliyordu,
  // yani kullanici `%` yazip tum kayitlari cekebiliyordu.
  const like = safeLike(q);
  const hits: SearchHit[] = [];
  // limit=20 → faktör 1 (mevcut davranış birebir); daha yüksek limitte oransal artar.
  const cap = Math.min(Math.max(Math.floor(limit) || 20, 1), 100);
  const factor = Math.max(1, Math.ceil(cap / 20));
  const per = (n: number) => n * factor;

  const [
    { data: customers },
    { data: properties },
    { data: demands },
    { data: tickets },
    { data: dealsByCustomer },
    { data: dealsByProperty },
    { data: tasks },
  ] = await Promise.all([
    supabase
      .from("customers")
      .select("id, full_name, phone")
      .is("deleted_at", null)
      .or(orIlike(["full_name", "phone", "email"], q))
      .limit(per(8)),
    supabase
      .from("properties")
      .select("id, property_code, title, parcel_block, parcel_lot")
      .or(orIlike(["property_code", "title", "parcel_block", "parcel_lot"], q))
      .limit(per(8)),
    supabase
      .from("customer_demands")
      .select("id, transaction_type, property_type, rooms, customer:customers(full_name)")
      .or(orIlike(["transaction_type", "property_type", "rooms"], q))
      .limit(per(6)),
    supabase
      .from("support_tickets")
      .select("id, subject")
      .ilike("subject", like)
      .limit(per(4)),
    // Anlaşmanın kendine ait serbest metni yok; müşteri adı ve portföy
    // başlığı/kodu üzerinden iki ayrı !inner sorgu — PostgREST tek `or`
    // içinde iki farklı gömülü tabloyu tarayamıyor.
    supabase
      .from("deals")
      .select(
        "id, stage, deal_type, deal_value, customer:customers!inner(full_name), property:properties(title, property_code)",
      )
      .eq("tenant_id", gate.tenantId)
      .ilike("customer.full_name", like)
      .limit(per(4)),
    supabase
      .from("deals")
      .select(
        "id, stage, deal_type, deal_value, customer:customers(full_name), property:properties!inner(title, property_code)",
      )
      .eq("tenant_id", gate.tenantId)
      .or(orIlike(["title", "property_code"], q), { referencedTable: "property" })
      .limit(per(4)),
    supabase
      .from("tasks")
      .select("id, title, kind, status, due_at")
      .eq("tenant_id", gate.tenantId)
      .or(orIlike(["title", "notes"], q))
      .limit(per(6)),
  ]);

  for (const c of customers ?? []) {
    hits.push({
      id: c.id,
      kind: "customer",
      title: c.full_name,
      subtitle: c.phone ? formatTurkishPhone(c.phone) : "Müşteri",
      href: `/app/musteriler/${c.id}`,
    });
  }

  for (const p of properties ?? []) {
    hits.push({
      id: p.id,
      kind: "property",
      title: p.title || p.property_code,
      subtitle: [p.property_code, p.parcel_block && p.parcel_lot ? `${p.parcel_block}/${p.parcel_lot}` : null]
        .filter(Boolean)
        .join(" · "),
      href: `/app/portfoyler/${p.id}`,
    });
  }

  for (const d of demands ?? []) {
    const cust = d.customer as { full_name?: string } | { full_name?: string }[] | null;
    const name = Array.isArray(cust) ? cust[0]?.full_name : cust?.full_name;
    hits.push({
      id: d.id,
      kind: "demand",
      title: `${d.transaction_type}${d.property_type ? ` · ${d.property_type}` : ""}`,
      subtitle: [name, d.rooms].filter(Boolean).join(" · ") || "Talep",
      href: `/app/eslestirme?demand=${d.id}`,
    });
  }

  const dealSeen = new Set<string>();
  for (const d of [...(dealsByCustomer ?? []), ...(dealsByProperty ?? [])] as DealHitRow[]) {
    if (dealSeen.has(d.id)) continue;
    dealSeen.add(d.id);
    const cust = Array.isArray(d.customer) ? d.customer[0] : d.customer;
    const prop = Array.isArray(d.property) ? d.property[0] : d.property;
    const value =
      d.deal_value != null
        ? new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(Number(d.deal_value)) + " ₺"
        : null;
    hits.push({
      id: d.id,
      kind: "deal",
      title: cust?.full_name || prop?.title || prop?.property_code || "Anlaşma",
      subtitle: [d.deal_type === "rent" ? "Kiralama" : "Satış", DEAL_STAGE_LABEL[d.stage] ?? d.stage, value]
        .filter(Boolean)
        .join(" · "),
      href: `/app/anlasmalar/${d.id}`,
    });
  }

  for (const t of tasks ?? []) {
    const due = t.due_at
      ? new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short" }).format(new Date(t.due_at))
      : null;
    hits.push({
      id: t.id,
      kind: "task",
      title: t.title,
      subtitle: [TASK_KIND_LABEL[t.kind] ?? "Görev", t.status === "done" ? "Tamamlandı" : due ? `Son: ${due}` : null]
        .filter(Boolean)
        .join(" · "),
      // Görev detay sayfası yok; "Tümü" filtresi görev durumundan bağımsız listeler.
      href: "/app/gorevler?filter=all",
    });
  }

  for (const t of tickets ?? []) {
    hits.push({
      id: t.id,
      kind: "ticket",
      title: t.subject,
      subtitle: "Destek talebi",
      href: `/app/destek/${t.id}`,
    });
  }

  return hits.slice(0, cap);
}
