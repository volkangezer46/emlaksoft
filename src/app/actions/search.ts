"use server";

import { createClient } from "@/lib/supabase/server";
import { requireActiveTenant } from "@/lib/tenant-guard";
import { formatTurkishPhone } from "@/lib/phone";

export type SearchHit = {
  id: string;
  kind: "customer" | "property" | "demand" | "ticket";
  title: string;
  subtitle: string;
  href: string;
};

export async function searchWorkspace(query: string): Promise<SearchHit[]> {
  const gate = await requireActiveTenant();
  if (!gate.ok) return [];

  const q = query.trim();
  if (q.length < 2) return [];

  const supabase = await createClient();
  const safe = q.replace(/[%_,]/g, " ").trim();
  const like = `%${safe}%`;
  const hits: SearchHit[] = [];

  const [{ data: customers }, { data: properties }, { data: demands }, { data: tickets }] =
    await Promise.all([
      supabase
        .from("customers")
        .select("id, full_name, phone")
        .is("deleted_at", null)
        .or(`full_name.ilike."${like}",phone.ilike."${like}",email.ilike."${like}"`)
        .limit(8),
      supabase
        .from("properties")
        .select("id, property_code, title, parcel_block, parcel_lot")
        .or(
          `property_code.ilike."${like}",title.ilike."${like}",parcel_block.ilike."${like}",parcel_lot.ilike."${like}"`,
        )
        .limit(8),
      supabase
        .from("customer_demands")
        .select("id, transaction_type, property_type, rooms, customer:customers(full_name)")
        .or(`transaction_type.ilike."${like}",property_type.ilike."${like}",rooms.ilike."${like}"`)
        .limit(6),
      supabase
        .from("support_tickets")
        .select("id, subject")
        .ilike("subject", like)
        .limit(4),
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

  for (const t of tickets ?? []) {
    hits.push({
      id: t.id,
      kind: "ticket",
      title: t.subject,
      subtitle: "Destek talebi",
      href: `/app/destek/${t.id}`,
    });
  }

  return hits.slice(0, 20);
}
