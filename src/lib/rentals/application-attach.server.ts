import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Onaylı başvurudan açılan kira kaydı (SP5): başvuru kira kaydına bağlanır, kefil bilgisi rentals.guarantor_* sütunlarına
 * taşınır. Başvuru AYNI portföy + AYNI ofisin onaylı kaydı olmalı; değilse sessizce atlanır (kira kaydı zaten açıldı).
 * Tablo/sütun yoksa (migration bekliyor) hata yutulur — kira kaydını asla bozmaz.
 */
export async function attachApplicationToRental(
  db: SupabaseClient,
  input: { tenantId: string; applicationId: string; rentalId: string; propertyId: string; renterId: string },
): Promise<{ attached: boolean }> {
  if (!UUID_RE.test(input.applicationId)) return { attached: false };
  try {
    const { data: app } = await db
      .from("rental_applications")
      .select("id, status, property_id, guarantor_name, guarantor_phone, guarantor_address, rental_id")
      .eq("id", input.applicationId)
      .eq("tenant_id", input.tenantId)
      .maybeSingle();
    if (!app || app.status !== "approved" || app.property_id !== input.propertyId || app.rental_id) return { attached: false };
    await db
      .from("rental_applications")
      .update({ rental_id: input.rentalId, customer_id: input.renterId })
      .eq("id", app.id)
      .eq("tenant_id", input.tenantId);
    if (app.guarantor_name) {
      await db
        .from("rentals")
        .update({ guarantor_name: app.guarantor_name, guarantor_phone: app.guarantor_phone, guarantor_address: app.guarantor_address })
        .eq("id", input.rentalId)
        .eq("tenant_id", input.tenantId);
    }
    return { attached: true };
  } catch (e) {
    console.error("attachApplicationToRental", e instanceof Error ? e.message : "unknown");
    return { attached: false };
  }
}
