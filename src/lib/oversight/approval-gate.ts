/**
 * Onay kapisi — `requestApprovalIfNeeded` (varsayilan KAPALI).
 *
 * Iki katman:
 *  1. `evaluateApprovalRule`: SAF karar (kural + payload -> gerekli mi, neden, talep metni). Testle kapali.
 *  2. `requestApprovalIfNeeded`: kapi. Kural kapaliysa / esik altindaysa / aktor yonetici ise HICBIR sey yapmaz
 *     ("not_required"); aksi halde mevcut onay_requests akisina (approval_requests) talep acar ya da daha once
 *     onaylanmis talebi TEK KULLANIMLIK tuketir.
 *
 * Baglanti (cagiran action'lar — bu dosya onlara dokunmaz):
 *   const gate = await requestApprovalIfNeeded(tenantId, userId, "price_drop", { oldPrice, newPrice, entityId: id, title });
 *   if (gate.status === "pending" || gate.status === "requested") return { error: gate.message };
 *   // gate.status === "not_required" | "approved" -> islem normal devam eder.
 *
 * Neden `approval_requests` yeniden kullanildi: yeni tablo/tur yok (mukerrer sistem yok). Islem turu
 * `description` basindaki "[oversight:<tur>:<kayit>]" parmak iziyle bulunur; mevcut kind'lere eslenir
 * (fiyat_degisikligi / komisyon_indirimi / ozel_izin), boylece /app/onaylar'da gorunur ve karar akisi aynidir.
 */
import type { ApprovalKind } from "@/lib/approvals";
import { now } from "@/lib/clock";
import {
  APPROVAL_ACTION_META,
  type ApprovalActionType,
  type ApprovalRules,
} from "@/lib/oversight/settings";

export type ApprovalPayload = {
  /** ilgili kayit (ilan id vb.); parmak izine girer. */
  entityId?: string | null;
  entityType?: "property" | "deal" | "expense" | null;
  /** kisa ad (ilan basligi / dosya adi) — talep basligina girer. */
  title?: string | null;
  /** price_drop */
  oldPrice?: number | null;
  newPrice?: number | null;
  /** commission_discount: yuzde puan (ornek 3 ve 2) */
  standardRate?: number | null;
  requestedRate?: number | null;
  /** bulk_export */
  rows?: number | null;
  exportEntity?: string | null;
  /** bulk_export: hizli (2000 satir) / tam akis. Parmak izine girer; hizli onay tam akista kullanilamaz. */
  channel?: "quick" | "full" | null;
};

export type ApprovalDecision =
  | { required: false }
  | {
      required: true;
      reason: string;
      kind: ApprovalKind;
      title: string;
      currentValue: number | null;
      requestedValue: number | null;
      fingerprint: string;
    };

const fmt = (n: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(n);

function fp(type: ApprovalActionType, p: ApprovalPayload): string {
  const key = p.entityId ?? p.exportEntity ?? "-";
  // Kanal parmak izinin parcasidir; deger ise tuketim aninda `approvalCovers` ile karsilastirilir.
  const channel = p.channel ? `:${p.channel}` : "";
  return `oversight:${type}:${key}${channel}`;
}

/**
 * SAF: onaylanmis talep, simdi yapilmak istenen islemi KAPSIYOR mu (deger baglama).
 * Yeni deger onaylanandan daha kotu olamaz: fiyat/komisyon onaylanan yeni degerin altina inemez,
 * export satir sayisi onaylananin ustune cikamaz. Onayli deger yoksa (eski kayit) kapsamaz.
 */
export function approvalCovers(
  actionType: ApprovalActionType,
  decision: Extract<ApprovalDecision, { required: true }>,
  open: { requestedValue?: number | null },
): boolean {
  if (actionType === "listing_delete") return true;
  const approved = open.requestedValue;
  const wanted = decision.requestedValue;
  if (approved == null || wanted == null || !Number.isFinite(approved) || !Number.isFinite(wanted)) return false;
  if (actionType === "bulk_export") return wanted <= approved;
  return wanted >= approved; // price_drop / commission_discount: daha derin dusus yok
}

/** SAF: kural + payload -> onay gerekli mi. Kapali kural / gecersiz veri her zaman `required:false`. */
export function evaluateApprovalRule(
  rules: ApprovalRules,
  actionType: ApprovalActionType,
  payload: ApprovalPayload,
): ApprovalDecision {
  const rule = rules[actionType];
  if (!rule || !rule.enabled) return { required: false };
  const label = APPROVAL_ACTION_META[actionType].label;
  const who = payload.title ? `: ${payload.title}` : "";

  switch (actionType) {
    case "price_drop": {
      const oldP = Number(payload.oldPrice);
      const newP = Number(payload.newPrice);
      if (!Number.isFinite(oldP) || !Number.isFinite(newP) || oldP <= 0 || newP >= oldP) return { required: false };
      const dropPct = ((oldP - newP) / oldP) * 100;
      if (dropPct < rule.threshold) return { required: false };
      return {
        required: true,
        reason: `Fiyat %${fmt(dropPct)} düşüyor (eşik %${fmt(rule.threshold)}).`,
        kind: "fiyat_degisikligi",
        title: `${label}${who}`,
        currentValue: oldP,
        requestedValue: newP,
        fingerprint: fp(actionType, payload),
      };
    }
    case "commission_discount": {
      const std = Number(payload.standardRate);
      const req = Number(payload.requestedRate);
      if (!Number.isFinite(std) || !Number.isFinite(req) || req >= std) return { required: false };
      const cut = std - req;
      if (cut < rule.threshold) return { required: false };
      return {
        required: true,
        reason: `Komisyon oranı ${fmt(cut)} puan düşüyor (eşik ${fmt(rule.threshold)} puan).`,
        kind: "komisyon_indirimi",
        title: `${label}${who}`,
        currentValue: std,
        requestedValue: req,
        fingerprint: fp(actionType, payload),
      };
    }
    case "listing_delete": {
      return {
        required: true,
        reason: "İlan silme işlemi için yönetici onayı isteniyor.",
        kind: "ozel_izin",
        title: `${label}${who}`,
        currentValue: null,
        requestedValue: null,
        fingerprint: fp(actionType, payload),
      };
    }
    case "bulk_export": {
      const rows = Number(payload.rows);
      if (!Number.isFinite(rows) || rows < rule.threshold) return { required: false };
      return {
        required: true,
        reason: `${fmt(rows)} satırlık veri indirilecek (eşik ${fmt(rule.threshold)}).`,
        kind: "ozel_izin",
        title: `${label}${who || (payload.exportEntity ? `: ${payload.exportEntity}` : "")}`,
        currentValue: rule.threshold,
        requestedValue: rows,
        fingerprint: fp(actionType, payload),
      };
    }
    default:
      return { required: false };
  }
}

/** Onayin gecerlilik suresi (saat): onaylanan talep bu sure icinde TEK KEZ kullanilabilir. */
export const APPROVAL_VALID_HOURS = 48;

export type OpenApprovalRow = {
  id: string;
  status: "bekliyor" | "onaylandi";
  decidedAt: string | null;
  /** Onaylanan talebin degerleri (tuketimde yeni islemle karsilastirilir). */
  requestedValue?: number | null;
  currentValue?: number | null;
};

/** DB bagimliliklari — testte sahtesi verilir. */
export type ApprovalGateStore = {
  loadRules(tenantId: string): Promise<ApprovalRules>;
  /** Aktor yonetici kademesinde mi (yonetici kendi islemini bekletmez). */
  isManager(tenantId: string, actorId: string): Promise<boolean>;
  /** Parmak izine uyan, aktorun en son bekleyen/onayli talebi. */
  findOpen(tenantId: string, actorId: string, fingerprint: string): Promise<OpenApprovalRow | null>;
  isConsumed(tenantId: string, approvalId: string): Promise<boolean>;
  /**
   * Onayi TEK KEZ tuket. true: bu cagri tuketti (islem devam edebilir); false: baska cagri tuketti, tuketilemedi
   * ya da denetim kaydi yazilamadi (onay tuketilmis sayilir, islem reddedilir).
   */
  consume(tenantId: string, actorId: string, approvalId: string): Promise<boolean>;
  create(
    tenantId: string,
    actorId: string,
    decision: Extract<ApprovalDecision, { required: true }>,
    payload: ApprovalPayload,
    actionType: ApprovalActionType,
  ): Promise<{ id: string } | null>;
};

export type ApprovalGateResult =
  | { status: "not_required" }
  | { status: "approved"; approvalId: string }
  | { status: "pending"; approvalId: string; message: string }
  | { status: "requested"; approvalId: string; message: string }
  | { status: "error"; message: string };

/**
 * Kapi. `store` verilmezse gercek (RLS'li) depo kullanilir.
 * Hata durumunda ISLEMI SESSIZCE SERBEST BIRAKMAZ: `error` doner, cagiran karar verir
 * (varsayilan oneri: kural acikken hata = islem durdurulur).
 */
export async function requestApprovalIfNeeded(
  tenantId: string,
  actorId: string,
  actionType: ApprovalActionType,
  payload: ApprovalPayload,
  store?: ApprovalGateStore,
  nowMs: number = now(),
): Promise<ApprovalGateResult> {
  try {
    const s = store ?? (await import("@/lib/oversight/approval-store")).createApprovalGateStore();
    // Okuma HATASI fail-open olamaz: firlatir -> asagidaki catch `error` doner (islem durur).
    // "Tablo yok" durumunu depo kendisi varsayilan kapaliya cevirir (bkz. loadApprovalRules).
    const rules = await s.loadRules(tenantId);
    const decision = evaluateApprovalRule(rules, actionType, payload);
    if (!decision.required) return { status: "not_required" };
    if (await s.isManager(tenantId, actorId)) return { status: "not_required" };

    const open = await s.findOpen(tenantId, actorId, decision.fingerprint);
    if (open?.status === "onaylandi") {
      const decided = open.decidedAt ? new Date(open.decidedAt).getTime() : NaN;
      const fresh = Number.isFinite(decided) && nowMs - decided <= APPROVAL_VALID_HOURS * 3_600_000;
      if (fresh && approvalCovers(actionType, decision, open) && !(await s.isConsumed(tenantId, open.id))) {
        // Atomik tuketim: yaristan kaybeden / denetim kaydi yazamayan cagri islemi REDDEDER.
        const consumed = await s.consume(tenantId, actorId, open.id);
        if (!consumed) {
          return {
            status: "error",
            message: "Onay kullanılamadı (zaten kullanılmış olabilir). Lütfen yeni bir onay talep edin.",
          };
        }
        return { status: "approved", approvalId: open.id };
      }
    }
    if (open?.status === "bekliyor") {
      return {
        status: "pending",
        approvalId: open.id,
        message: "Bu işlem için yönetici onayı bekleniyor. Karar verilince işleminizi tamamlayabilirsiniz.",
      };
    }

    const created = await s.create(tenantId, actorId, decision, payload, actionType);
    if (!created) return { status: "error", message: "Onay talebi oluşturulamadı. Lütfen tekrar deneyin." };
    return {
      status: "requested",
      approvalId: created.id,
      message: `Bu işlem ofis kuralı gereği yönetici onayı gerektiriyor (${decision.reason}) Talebiniz iletildi; onaylanınca işlemi tekrar yapabilirsiniz.`,
    };
  } catch (e) {
    console.error("requestApprovalIfNeeded", e);
    return { status: "error", message: "Onay kuralı denetlenemedi. Lütfen tekrar deneyin." };
  }
}
