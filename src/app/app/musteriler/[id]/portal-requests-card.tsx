import { Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PortalRequestButtons } from "./portal-request-buttons";

const money = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);

/**
 * Müşterinin portaldan gönderdiği BEKLEYEN arayış güncelleme istekleri. Portal talebi doğrudan değiştirmez;
 * danışman burada onaylayınca talep güncellenir (bütçe / oda / bölge). Bekleyen yoksa kart hiç çizilmez.
 */
export async function PortalRequestsCard({ customerId, tenantId, canEdit }: { customerId: string; tenantId: string; canEdit: boolean }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("portal_demand_updates")
    .select("id, budget_min, budget_max, rooms, area_text, note, created_at, demand:customer_demands!portal_demand_updates_demand_id_fkey(transaction_type, property_type, budget_min, budget_max, rooms)")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(5);
  if (error || !data || data.length === 0) return null;

  return (
    <Card id="portal-istekleri" className="scroll-mt-24">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Inbox className="h-4 w-4 text-brand-600" aria-hidden="true" /> Portaldan gelen arayış güncelleme isteği
          </CardTitle>
          <CardDescription>Müşteri kendi panelinden değişiklik istedi. Onaylayınca talep güncellenir; reddedersen talep olduğu gibi kalır.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.map((u) => {
          const d = Array.isArray(u.demand) ? u.demand[0] : u.demand;
          const lines: string[] = [];
          if (u.budget_min != null || u.budget_max != null) {
            lines.push(
              `Bütçe: ${d?.budget_min != null || d?.budget_max != null ? `${d?.budget_min != null ? money(Number(d.budget_min)) : "—"} – ${d?.budget_max != null ? money(Number(d.budget_max)) : "—"} → ` : ""}${u.budget_min != null ? money(Number(u.budget_min)) : "—"} – ${u.budget_max != null ? money(Number(u.budget_max)) : "—"}`,
            );
          }
          if (u.rooms) lines.push(`Oda: ${d?.rooms ? `${d.rooms} → ` : ""}${u.rooms}`);
          if (u.area_text) lines.push(`Bölge: ${u.area_text}`);
          if (u.note) lines.push(`Not: ${u.note}`);
          return (
            <div key={u.id as string} className="rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-3">
              <p className="text-xs font-semibold text-text-muted">{[d?.transaction_type, d?.property_type].filter(Boolean).join(" · ") || "Arayış"}</p>
              <ul className="mt-1 space-y-0.5 text-sm text-ink-950">
                {lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              {canEdit ? <PortalRequestButtons kind="demand" id={u.id as string} /> : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
