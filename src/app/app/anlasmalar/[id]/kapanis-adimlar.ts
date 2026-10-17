/**
 * "Satışı kapat" ve "Kaybedildi" sihirbazlarının adımları + gönderim planı (SAF; IO yalnız enjekte edilen action'larda).
 * İş kuralı MEVCUT action'larda kalır:
 *   · `updateDeal` (nihai tutar), `updatePropertyCommissionRate` (oran yoksa),
 *   · `updateDealStage` → `transition_deal_stage_atomic` (aşama + komisyon kaydı + portföy "Satıldı" TEK işlem; WP2:
 *     owner/gm dışındaki roller için yönetici onayı),
 *   · `updateCommissionSplits` (paylar; WP2 onayı), `createTask` (tahsilat vadesi / geri kazanım takibi).
 */
import { Banknote, CalendarClock, FileSignature, Home, PieChart, ThumbsDown } from "lucide-react";
import * as z from "zod/mini";
import { formatTry } from "@/lib/format";
import { decodeSplits, parseMoney, parsePercent, salePreview, splitRowsError } from "@/lib/sihirbaz/hesap";
import type { PlanTask, TaskOutcome, WizardStep, WizardValues } from "@/components/ui/wizard/engine";
import { zodStep } from "@/components/ui/wizard/zod-step";
import { COLLECTION_TASK_PREFIX, buildLossNote, isReadyToWin, wonReadiness } from "./kapanis-model";

/** Onay kapısının DURUM iletisi (hata değil): `APPROVAL_PENDING_MESSAGE` ("…yönetici onayı bekliyor…"). */
export function isApprovalPending(message: string | null | undefined): boolean {
  return /yönetici onayı bekliyor/i.test(message ?? "");
}

export const WON_DRAFT_FIELDS = ["deal_value", "commission_rate", "splits", "due_at", "confirm_property"] as const;
export const LOST_DRAFT_FIELDS = ["loss_reason", "takip", "takip_due"] as const;

export type WonContext = {
  dealId: string;
  dealType: string;
  propertyId: string | null;
  propertyTitle: string | null;
  propertyStatusLabel: string | null;
  customerId: string | null;
  customerName: string | null;
  /** Kayıtlı anlaşma tutarı. */
  dealValue: number | null;
  /** Portföy komisyon oranı. */
  commissionRate: number | null;
  showMoney: boolean;
  canSetRate: boolean;
  canCreateTask: boolean;
  hasCollectionTask: boolean;
  /** Kazanıldı ve paylaşım yönetici onayına gider (owner/gm dışı roller). */
  needsApproval: boolean;
};

function rateOf(v: WizardValues, c: WonContext): number | null {
  return c.commissionRate != null && c.commissionRate > 0 ? c.commissionRate : parsePercent(v.commission_rate);
}

export function wonSteps(c: WonContext): WizardStep[] {
  const valueValidate = zodStep(
    z.object({
      deal_value: z.string().check(z.refine((s) => parseMoney(s) != null, { message: "Nihai tutarı girin." })),
    }),
    { fieldIds: { deal_value: "wz-won-value" } },
  );
  return [
    {
      id: "tutar",
      label: "Nihai fiyat",
      short: "Fiyat",
      description: "Pazarlık sonunda anlaşılan tutar; komisyon bundan hesaplanır.",
      icon: Banknote,
      validate: (v) => {
        const out = valueValidate(v);
        if (c.showMoney && rateOf(v, c) == null) {
          out.push({
            field: "wz-won-rate",
            message: c.canSetRate ? "Portföyde komisyon oranı yok; oranı girin." : "Portföyde komisyon oranı yok; portföy sorumlusu oranı girmeli.",
          });
        }
        return out;
      },
      summary: (v) => {
        const value = parseMoney(v.deal_value);
        const rate = rateOf(v, c);
        return [
          { label: "Nihai tutar", value: value != null ? formatTry(value) : "Girilmedi", muted: value == null },
          ...(c.dealValue != null && value != null && value !== c.dealValue ? [{ label: "Önceki tutar", value: formatTry(c.dealValue) }] : []),
          ...(c.showMoney ? [{ label: "Komisyon oranı", value: rate != null ? `%${String(rate).replace(".", ",")}` : "Yok", muted: rate == null }] : []),
        ];
      },
    },
    {
      id: "paylar",
      label: "Komisyon ve paylar",
      short: "Paylar",
      description: c.needsApproval
        ? "Paylaşımı belirleyin. Rolünüzde kazanma ve paylaşım değişikliği yönetici onayına gider."
        : "Komisyonu taraflar arasında oranla paylaştırın.",
      icon: PieChart,
      when: () => c.showMoney,
      validate: (v) => {
        const err = splitRowsError(decodeSplits(v.splits));
        return err ? [{ field: "wz-split-0-rate", message: err }] : [];
      },
      summary: (v) => {
        const p = salePreview(parseMoney(v.deal_value), rateOf(v, c), decodeSplits(v.splits));
        if (!p) return [{ label: "Komisyon", value: "Hesaplanamadı", muted: true }];
        return [
          { label: "Komisyon (KDV hariç)", value: formatTry(p.net) },
          ...p.rows.map((r) => ({ label: `${r.label} (%${String(r.rate).replace(".", ",")})`, value: formatTry(r.amount) })),
        ];
      },
    },
    {
      id: "portfoy",
      label: "Portföy durumu",
      short: "Portföy",
      description: "Kapanışla portföy “Satıldı” olur, ilanı yayından iner ve komisyon kaydı açılır.",
      icon: Home,
      validate: (v) => {
        const items = wonReadiness(
          { dealType: c.dealType, hasProperty: Boolean(c.propertyId), hasCustomer: Boolean(c.customerId), dealValue: parseMoney(v.deal_value), commissionRate: c.showMoney ? rateOf(v, c) : 1 },
          { dealId: c.dealId, propertyId: c.propertyId },
        );
        const out = isReadyToWin(items) ? [] : [{ field: "wz-won-ready", message: "Eksik ön koşulları tamamlayın." }];
        if (v.confirm_property !== "1") out.push({ field: "wz-won-confirm", message: "Portföy durum değişikliğini onaylayın." });
        return out;
      },
      summary: (v) => [
        { label: "Portföy", value: c.propertyTitle ?? "Bağlı değil", muted: !c.propertyTitle },
        { label: "Durum", value: `${c.propertyStatusLabel ?? "—"} → Satıldı` },
        { label: "Onay", value: v.confirm_property === "1" ? "Onaylandı" : "Bekliyor", muted: v.confirm_property !== "1" },
      ],
    },
    {
      id: "belgeler",
      label: "Sözleşme ve vade",
      short: "Belgeler",
      description: "Satış sözleşmesini bağlayın ve komisyon tahsilat vadesini belirleyin.",
      icon: FileSignature,
      optional: true,
      summary: (v) => [
        {
          label: "Tahsilat vadesi",
          value: c.hasCollectionTask ? "Görev zaten açık" : v.due_at ? v.due_at.replace("T", " ").split(" ")[0].split("-").reverse().join(".") : "Görev açılmayacak",
          muted: !v.due_at && !c.hasCollectionTask,
        },
      ],
    },
  ];
}

export type WonActions = {
  updateDeal: (fd: FormData) => Promise<{ ok?: boolean; error?: string }>;
  setRate: (propertyId: string, rate: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  win: (fd: FormData) => Promise<{ ok?: boolean; error?: string }>;
  commissionId: (dealId: string) => Promise<{ id?: string; error?: string }>;
  saveSplits: (commissionId: string, rows: { label: string; rate: number }[]) => Promise<{ ok?: boolean; error?: string }>;
  createTask: (fd: FormData) => Promise<{ ok?: boolean; error?: string }>;
};

/**
 * Kapanış planı: (değiştiyse) tutar → (yoksa) oran → KAZANILDI (atomik: aşama + komisyon + portföy) → paylar →
 * (istenirse) tahsilat görevi. Kazanma onay bekliyorsa plan durur ve DURUM olarak bildirilir (taslak saklanır).
 * Paylaşım onaya düşerse kapanış tamamdır; komisyon ofis varsayılan paylarıyla açık kalır, not düşülür.
 */
export function wonPlan(v: WizardValues, skipped: ReadonlySet<string>, c: WonContext, a: WonActions): PlanTask[] {
  const tasks: PlanTask[] = [];
  const value = parseMoney(v.deal_value);
  if (value != null && value !== c.dealValue) {
    tasks.push({
      id: "tutar",
      label: "Nihai tutar",
      run: async () => {
        const fd = new FormData();
        fd.set("deal_id", c.dealId);
        fd.set("deal_value", v.deal_value);
        const res = await a.updateDeal(fd);
        return res.error ? { ok: false, error: res.error } : { ok: true };
      },
    });
  }
  if (c.propertyId && !(c.commissionRate && c.commissionRate > 0) && parsePercent(v.commission_rate) != null) {
    const pid = c.propertyId;
    tasks.push({
      id: "oran",
      label: "Portföy komisyon oranı",
      run: async () => {
        const res = await a.setRate(pid, v.commission_rate);
        return res.ok ? { ok: true } : { ok: false, error: res.error };
      },
    });
  }
  tasks.push({
    id: "kazan",
    label: "Kazanıldı: komisyon kaydı ve portföy durumu",
    run: async (): Promise<TaskOutcome> => {
      const fd = new FormData();
      fd.set("deal_id", c.dealId);
      fd.set("stage", "won");
      const res = await a.win(fd);
      if (res.error) return { ok: false, error: res.error, kind: isApprovalPending(res.error) ? "approval" : "error" };
      return { ok: true };
    },
  });
  if (c.showMoney) {
    tasks.push({
      id: "paylar",
      label: "Komisyon payları",
      run: async (): Promise<TaskOutcome> => {
        const ref = await a.commissionId(c.dealId);
        if (!ref.id) return { ok: false, error: ref.error ?? "Komisyon kaydı bulunamadı; Yeniden dene." };
        const rows = decodeSplits(v.splits)
          .map((r) => ({ label: r.label.trim(), rate: Number(String(r.rate).replace(",", ".")) || 0 }))
          .filter((r) => r.label && r.rate > 0);
        const res = await a.saveSplits(ref.id, rows);
        if (res.error && isApprovalPending(res.error)) {
          return { ok: true, note: "Paylaşım yönetici onayına gönderildi; onaylanınca kayda geçer." };
        }
        return res.error ? { ok: false, error: res.error } : { ok: true };
      },
    });
  }
  if (!skipped.has("belgeler") && v.due_at && c.canCreateTask && !c.hasCollectionTask) {
    tasks.push({
      id: "vade",
      label: "Tahsilat görevi",
      run: async () => {
        const fd = new FormData();
        fd.set("title", `${COLLECTION_TASK_PREFIX}: ${c.propertyTitle ?? "anlaşma"} (${c.customerName ?? "müşteri"})`);
        fd.set("kind", "followup");
        fd.set("priority", "high");
        fd.set("due_at", v.due_at);
        fd.set("deal_id", c.dealId);
        if (c.customerId) fd.set("customer_id", c.customerId);
        if (c.propertyId) fd.set("property_id", c.propertyId);
        const res = await a.createTask(fd);
        return res.error ? { ok: false, error: res.error } : { ok: true };
      },
    });
  }
  return tasks;
}

// ---- Kaybedildi ----------------------------------------------------------------------------------------------

export type LostContext = { dealId: string; customerId: string | null; propertyId: string | null; canCreateTask: boolean };

export function lostSteps(c: LostContext, reasonLabel: (v: string) => string): WizardStep[] {
  return [
    {
      id: "neden",
      label: "Kayıp nedeni",
      short: "Neden",
      description: "Raporlar ve kayıp-satış analizi bu bilgiyle çalışır.",
      icon: ThumbsDown,
      validate: (v) => {
        const out = [];
        if (!v.loss_reason) out.push({ field: "wz-lost-reason", message: "Kayıp nedenini seçin." });
        if (v.loss_reason === "diger" && !(v.loss_extra ?? "").trim()) out.push({ field: "wz-lost-extra", message: "Diğer seçildiğinde açıklama zorunlu." });
        return out;
      },
      summary: (v) => [
        { label: "Neden", value: v.loss_reason ? reasonLabel(v.loss_reason) : "Seçilmedi", muted: !v.loss_reason },
        ...(v.loss_competitor ? [{ label: "Rakip", value: v.loss_competitor }] : []),
        ...(v.loss_price ? [{ label: "Fiyat notu", value: v.loss_price }] : []),
      ],
    },
    {
      id: "takip",
      label: "Geri kazanım takibi",
      short: "Takip",
      description: "Müşteriyi unutmayın: ileri bir tarihe takip görevi ekleyin ya da atlayın.",
      icon: CalendarClock,
      optional: true,
      when: () => c.canCreateTask,
      validate: (v) =>
        v.takip === "1" && !(v.takip_title ?? "").trim() ? [{ field: "wz-lost-task", message: "Görev başlığını yazın." }] : [],
      summary: (v) => [{ label: "Takip görevi", value: v.takip === "1" ? (v.takip_title ?? "") : "Açılmayacak", muted: v.takip !== "1" }],
    },
  ];
}

export function lostPlan(
  v: WizardValues,
  skipped: ReadonlySet<string>,
  c: LostContext,
  a: { lose: (fd: FormData) => Promise<{ ok?: boolean; error?: string }>; createTask: (fd: FormData) => Promise<{ ok?: boolean; error?: string }> },
): PlanTask[] {
  const reason = v.loss_reason ?? "";
  const tasks: PlanTask[] = [
    {
      id: "kaybet",
      label: "Kaybedildi olarak kapat",
      run: async () => {
        const fd = new FormData();
        fd.set("deal_id", c.dealId);
        fd.set("stage", "lost");
        fd.set("loss_reason", reason);
        fd.set("loss_note", buildLossNote(v.loss_competitor ?? "", v.loss_price ?? "", v.loss_extra ?? ""));
        const res = await a.lose(fd);
        return res.error ? { ok: false, error: res.error } : { ok: true };
      },
    },
  ];
  if (c.canCreateTask && !skipped.has("takip") && v.takip === "1") {
    tasks.push({
      id: "takip",
      label: "Geri kazanım görevi",
      run: async () => {
        const fd = new FormData();
        fd.set("title", v.takip_title ?? "");
        fd.set("kind", "followup");
        fd.set("due_at", v.takip_due ?? "");
        fd.set("deal_id", c.dealId);
        if (c.customerId) fd.set("customer_id", c.customerId);
        if (c.propertyId) fd.set("property_id", c.propertyId);
        const res = await a.createTask(fd);
        return res.error ? { ok: false, error: res.error } : { ok: true, note: "Takip görevi oluşturuldu." };
      },
    });
  }
  return tasks;
}
