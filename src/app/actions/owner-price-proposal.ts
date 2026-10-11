"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { proposalMessage } from "@/lib/price-proposals/model";

export type OwnerPriceDecisionResult = { ok: boolean; message: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECISIONS = new Set(["approved", "rejected", "note"]);

/**
 * Malik portalı: fiyat önerisine karar (Onaylıyorum / Reddediyorum / Not ekle). service_role YOK: oturumsuz istemciyle
 * `decide_property_price_proposal_by_token` RPC'si çağrılır; token, öneri-portföy eşleşmesi (KVKK: yalnız kendi mülkü),
 * süre ve fiyat kapısı SQL içinde doğrulanır (20261012000800). Burada yalnız biçim + IP hız sınırı.
 */
export async function decideOwnerPriceProposal(fd: FormData): Promise<OwnerPriceDecisionResult> {
  const token = String(fd.get("token") ?? "").trim();
  const proposalId = String(fd.get("proposal_id") ?? "").trim();
  const decision = String(fd.get("decision") ?? "").trim();
  const note = String(fd.get("note") ?? "").trim().slice(0, 500);
  if (!/^[0-9a-f]{32,128}$/.test(token) || !UUID_RE.test(proposalId) || !DECISIONS.has(decision)) {
    return { ok: false, message: "Geçersiz istek." };
  }
  if (decision === "note" && note.length === 0) return { ok: false, message: proposalMessage("note_required").text };

  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`ownerpriceprop:${ip}`, { limit: 10, windowSec: 60, failurePolicy: "deny" });
  if (!allowed) return { ok: false, message: proposalMessage("rate_limited").text };

  const db = await createClient();
  const { data, error } = await db.rpc("decide_property_price_proposal_by_token", {
    p_token: token,
    p_proposal_id: proposalId,
    p_decision: decision,
    p_note: note || null,
  });
  if (error) {
    console.error("decideOwnerPriceProposal", { code: error.code });
    return { ok: false, message: proposalMessage("error").text };
  }
  const m = proposalMessage((data as { code?: string } | null)?.code ?? "error");
  if (!m.ok) return { ok: false, message: m.text };

  revalidatePath(`/malik-portali/${token}`);
  const done =
    decision === "approved"
      ? "Teşekkürler, yeni fiyat onaylandı ve ilanınıza yansıtıldı."
      : decision === "rejected"
        ? "Önerilen fiyat reddedildi. Danışmanınız sizinle iletişime geçecek."
        : "Notunuz danışmanınıza iletildi.";
  return { ok: true, message: done };
}
