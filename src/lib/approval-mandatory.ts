/**
 * ZORUNLU ONAY KAPISI (WP2, sahip kararı) — owner/gm dışındaki rollerde "Kazanıldı" ve komisyon paylaşımı değişikliği.
 *
 * Ofis kontrolü kapısıyla (`lib/oversight/approval-gate.ts`, kurala bağlı ve varsayılan KAPALI) aynı tabloyu ve aynı
 * tek-kullanımlık tüketimi kullanır (`approval_requests` + `consumed_at`), ama kural okumaz: her zaman açıktır.
 *
 * Akış (çağıran action):
 *   const ap = await checkMandatoryApproval({ ... });
 *   if (ap.status === "pending" || ap.status === "requested" || ap.status === "error") return { error: ap.message };
 *   // işlem ...
 *   if (ap.status === "approved") await consumeMandatoryApproval(tenantId, actorId, ap.approvalId);
 *
 * Tüketim işlem BAŞARILI olduktan sonra yapılır: işlem bir ön koşul yüzünden düşerse onay boşa harcanmaz. Parmak izi
 * kaydı (ve paylaşımda satır özetini) taşıdığı için bir onay başka kayıtta/başka paylaşımda kullanılamaz; aynı kayıt
 * yalnız bir kez kazanılabildiğinden tüketim sırası yarışı ikinci bir kazanç doğurmaz.
 */
import { now } from "@/lib/clock";
import { logActivity } from "@/lib/activity";
import { notifyTenant } from "@/lib/notify";
import { createClient } from "@/lib/supabase/server";
import { createApprovalGateStore } from "@/lib/oversight/approval-store";
import { APPROVAL_PENDING_MESSAGE, APPROVAL_VALID_HOURS, type ApprovalGateStore } from "@/lib/oversight/approval-gate";
import {
  MANDATORY_APPROVAL_META,
  mandatoryApprovalCovers,
  mandatoryApprovalFingerprint,
  needsMandatoryApproval,
  type MandatoryApprovalAction,
} from "@/lib/approvals";

export type MandatoryApprovalInput = {
  tenantId: string;
  actorId: string;
  role: string;
  action: MandatoryApprovalAction;
  entityId: string;
  /** Onaylar ekranındaki "İlgili kayıt" bağlantısı (türü); kimlik `linkId` verilmezse `entityId`. */
  entityType: "deal" | "expense" | "property" | null;
  linkId?: string | null;
  /** Talep başlığında görünen kısa ad (ör. "Ahmet Yılmaz · K-1024"). */
  title: string;
  /** Parmak izine giren ek özet (paylaşım satırlarının özeti). */
  variant?: string | null;
  currentValue?: number | null;
  requestedValue?: number | null;
  /** Talep açıklamasına eklenen ayrıntı (ör. yeni paylaşım satırları). */
  detail?: string | null;
};

export type MandatoryApprovalResult =
  | { status: "not_required" }
  | { status: "approved"; approvalId: string }
  | { status: "pending"; approvalId: string; message: string }
  | { status: "requested"; approvalId: string; message: string }
  | { status: "error"; message: string };

export type MandatoryApprovalStore = Pick<ApprovalGateStore, "findOpen" | "isConsumed" | "consume"> & {
  create(input: MandatoryApprovalInput, fingerprint: string): Promise<{ id: string } | null>;
};

function defaultStore(): MandatoryApprovalStore {
  const base = createApprovalGateStore();
  return {
    findOpen: base.findOpen,
    isConsumed: base.isConsumed,
    consume: base.consume,
    async create(input, fingerprint) {
      const meta = MANDATORY_APPROVAL_META[input.action];
      const supabase = await createClient();
      const detail = input.detail ? ` ${input.detail}` : "";
      const { data, error } = await supabase
        .from("approval_requests")
        .insert({
          tenant_id: input.tenantId,
          kind: meta.kind,
          title: `${meta.label}: ${input.title}`.slice(0, 200),
          description: `[${fingerprint}] ${meta.reason}${detail}`.slice(0, 2000),
          amount: input.requestedValue ?? null,
          current_value: input.currentValue ?? null,
          requested_value: input.requestedValue ?? null,
          entity_type: input.entityType,
          entity_id: input.entityType ? (input.linkId ?? input.entityId) : null,
          status: "bekliyor",
          requested_by: input.actorId,
        })
        .select("id")
        .single();
      if (error || !data) return null;
      await logActivity({
        tenantId: input.tenantId,
        actorId: input.actorId,
        action: "approval.mandatory_requested",
        entityType: "approval_request",
        entityId: data.id,
        newValue: { action: input.action, entity_id: input.entityId },
      });
      // Karar yetkilisi varsayılan olarak owner/gm: iş akışını bloklayan karar isteği, tercih anahtarı yok.
      const { data: managers } = await supabase
        .from("profiles")
        .select("id")
        .eq("tenant_id", input.tenantId)
        .eq("is_active", true)
        .in("role", ["owner", "gm"]);
      await Promise.all(
        (managers ?? [])
          .filter((m) => m.id !== input.actorId)
          .map((m) =>
            notifyTenant({
              tenantId: input.tenantId,
              userId: m.id as string,
              title: `Onay bekliyor: ${meta.label}`,
              body: input.title,
              href: "/app/onaylar?durum=bekliyor",
              kind: "warning",
            }).catch(() => undefined),
          ),
      );
      return { id: data.id as string };
    },
  };
}

/**
 * Onay gerekli mi, varsa durumu ne. Onaylı ve tüketilmemiş talep bulunursa `approved` döner ama TÜKETMEZ
 * (bkz. `consumeMandatoryApproval`). Okuma hatası işlemi serbest bırakmaz: `error` döner.
 */
export async function checkMandatoryApproval(
  input: MandatoryApprovalInput,
  store?: MandatoryApprovalStore,
  nowMs: number = now(),
): Promise<MandatoryApprovalResult> {
  if (!needsMandatoryApproval(input.role)) return { status: "not_required" };
  try {
    const s = store ?? defaultStore();
    const fingerprint = mandatoryApprovalFingerprint(input.action, input.entityId, input.variant ?? null);
    const open = await s.findOpen(input.tenantId, input.actorId, fingerprint);
    if (open?.status === "onaylandi") {
      const decided = open.decidedAt ? new Date(open.decidedAt).getTime() : NaN;
      const fresh = Number.isFinite(decided) && nowMs - decided <= APPROVAL_VALID_HOURS * 3_600_000;
      if (
        fresh &&
        mandatoryApprovalCovers(input.action, { requestedValue: open.requestedValue }, { requestedValue: input.requestedValue }) &&
        !(await s.isConsumed(input.tenantId, open.id))
      ) {
        return { status: "approved", approvalId: open.id };
      }
    }
    if (open?.status === "bekliyor") return { status: "pending", approvalId: open.id, message: APPROVAL_PENDING_MESSAGE };
    const created = await s.create(input, fingerprint);
    if (!created) return { status: "error", message: "Onay talebi oluşturulamadı. Lütfen tekrar deneyin." };
    return { status: "requested", approvalId: created.id, message: APPROVAL_PENDING_MESSAGE };
  } catch (e) {
    console.error("checkMandatoryApproval", e instanceof Error ? e.message : e);
    return { status: "error", message: "Onay durumu denetlenemedi. Lütfen tekrar deneyin." };
  }
}

/** Başarılı işlemden sonra onayı TEK KEZ tüketir. Tüketilemezse (yarış) yalnız günlüğe yazılır; işlem geri alınmaz. */
export async function consumeMandatoryApproval(
  tenantId: string,
  actorId: string,
  approvalId: string,
  store?: Pick<MandatoryApprovalStore, "consume">,
): Promise<boolean> {
  try {
    const ok = await (store ?? defaultStore()).consume(tenantId, actorId, approvalId);
    if (!ok) console.error("consumeMandatoryApproval: onay tüketilemedi", { approvalId });
    return ok;
  } catch (e) {
    console.error("consumeMandatoryApproval", e instanceof Error ? e.message : e);
    return false;
  }
}
