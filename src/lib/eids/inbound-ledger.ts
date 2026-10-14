import type { SupabaseClient } from "@supabase/supabase-js";
import { applyAuthorityEvent } from "./ledger";
import { scheduleAuthorityEventActions } from "./actions-dispatch";
import type { InboundApplier } from "./inbound";

/**
 * EP3 → EP2 köprüsü: gelen e-postadan çıkan olay YALNIZ EP2 defterinin tek yazma noktasıyla (`applyAuthorityEvent`)
 * işlenir. Verme → 'approved' (+ bitiş tarihi portföyün authorization_end'ine), iptal → 'revoked'. Doğrulanmış kaynak
 * `verified` işaretini taşır; her durumda "Bakanlık e-postası görüldü" (authority_last_email_at) yazılır.
 * `db`: SMTP köprüsünde service_role (kiracı parametre), onayda service_role istemci.
 * Başarılı yazımdan sonra aksiyon motoru aynı istekte çalışır (anlık akış; iptal → danışmana ACİL kaldırma görevi).
 */
export function ledgerApplier(db: SupabaseClient): InboundApplier {
  return async (i) => {
    const r = await applyAuthorityEvent(db, {
      tenantId: i.tenantId,
      propertyId: i.propertyId,
      kind: i.kind,
      source: i.source,
      newStatus: i.kind === "grant" ? "approved" : "revoked",
      validUntil: i.validUntil,
      setValidUntil: i.kind === "grant" && Boolean(i.validUntil),
      eidsPropertyNo: i.eidsPropertyNo,
      bindPropertyNo: Boolean(i.bindPropertyNo),
      dealKind: i.dealKind,
      grantorName: i.grantorName,
      inboundMessageId: i.inboundMessageId,
      verified: i.source === "email_verified",
      emailSeen: true,
      actorId: i.actorId,
    });
    if (!r.ok) return { ok: false, error: r.error };
    scheduleAuthorityEventActions(i.tenantId, r.eventId, db);
    return { ok: true, eventId: r.eventId };
  };
}
