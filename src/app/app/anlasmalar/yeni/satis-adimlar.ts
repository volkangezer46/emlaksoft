/**
 * Satış sihirbazı (/app/anlasmalar/yeni) — adım tanımı, doğrulama, özet ve gönderim planı (SAF; IO yalnız enjekte edilen
 * action'larda). İş kuralı MEVCUT action'larda: `createPipelineDeal` (boş anlaşma kuralı `dealMissing` istemciyle ortak,
 * müzakere için yetki belgesi + iki taraf, WP2 müşteri kapsamı), `updatePropertyCommissionRate`, `createOffer`.
 */
import { Banknote, FileText, Home, UserRound } from "lucide-react";
import * as z from "zod/mini";
import { hasValue } from "@/lib/form-rules";
import { dealTypeLabel } from "@/lib/deal-type-label";
import { OPEN_DEAL_STAGES } from "@/lib/workflow-state";
import { dealMissing } from "./deal-rules";

export { dealMissing };
import { formatTry } from "@/lib/format";
import { parseMoney, parsePercent, salePreview, type SplitInput } from "@/lib/sihirbaz/hesap";
import { toFormData, type PlanTask, type TaskOutcome, type WizardStep, type WizardValues } from "@/components/ui/wizard/engine";
import { zodStep } from "@/components/ui/wizard/zod-step";

export const SALE_WIZARD_ID = "satis";

/**
 * Taslağa yazılan alanlar: kimlikler, tutar ve seçimler. Müşteri ADI, not ve özel alanlar (kişisel olabilir) yazılmaz;
 * geri yüklemede müşteri seçili kalır, adı seçicide "Seçili müşteri" görünür.
 */
export const SALE_DRAFT_FIELDS = [
  "customer_id",
  "property_id",
  "property_label",
  "property_code",
  "list_price",
  "property_rate",
  "transaction_type",
  "deal_type",
  "stage",
  "deal_value",
  "has_authority",
  "commission_rate",
  "teklif",
  "offer_amount",
  "offer_valid_until",
] as const;

/** createPipelineDeal'ın okuduğu alanlar (özel alanlar `cf_*` ayrıca eklenir). */
export const DEAL_ACTION_FIELDS = ["property_id", "customer_id", "deal_type", "stage", "deal_value", "has_authority"] as const;

/** Yeni anlaşmanın açılabileceği aşamalar (kapanmış aşamada açılmaz; sunucu da reddeder). */
export const OPEN_STAGES = OPEN_DEAL_STAGES;

/** Portföyün işlem türünden anlaşma türü önerisi (Kiralık → rent); bilinmiyorsa satış. */
export function dealTypeForProperty(tx: string | null | undefined): "sale" | "rent" {
  return /kira|rent/i.test(tx ?? "") ? "rent" : "sale";
}

export type SaleStepOptions = {
  /** Teklif adımı (offers:create ve portföy seçiliyse anlamlı). */
  canOffer: boolean;
  /** Oran portföyde yoksa girilebilir mi (properties:edit). */
  canSetRate: boolean;
  /** Ofis paylaşım kuralı (önizleme). */
  splits: SplitInput[];
  /** Zorunlu özel alanlar: `cf_<id>` → DOM id. */
  requiredCustomFields: { name: string; fieldId: string; label: string }[];
  stageName: (key: string) => string;
  /** Bugün (YYYY-MM-DD): teklif son tarihi geçmişte olamaz. */
  today: string;
};

const money = (raw: string | undefined) => {
  const n = parseMoney(raw);
  return n != null ? formatTry(n) : null;
};

/** Portföyde oran yoksa girilen oran; varsa portföy oranı. */
export function effectiveRate(v: WizardValues): number | null {
  return parsePercent(v.property_rate) ?? parsePercent(v.commission_rate);
}

export function saleSteps(o: SaleStepOptions): WizardStep[] {
  const fiyatSchema = z.object({
    deal_value: z.string().check(
      z.refine((s) => parseMoney(s) != null, { message: "Anlaşma tutarını girin (ör. 4.500.000)." }),
      z.refine((s) => (parseMoney(s) ?? 0) <= 100_000_000_000, { message: "Tutar çok büyük." }),
    ),
    commission_rate: z.optional(
      z.string().check(z.refine((s) => s.trim() === "" || parsePercent(s) != null, { message: "Oran 0'dan büyük, en çok 100 ve en çok iki ondalık olmalı." })),
    ),
  });
  const fiyatValidate = zodStep(fiyatSchema, { fieldIds: { deal_value: "wz-deal-value", commission_rate: "wz-deal-rate" } });

  return [
    {
      id: "musteri",
      label: "Müşteri",
      description: "Alıcıyı seçin. Müşteri seçmezseniz sonraki adımda portföy zorunludur.",
      icon: UserRound,
      summary: (v) => [{ label: "Müşteri", value: v.customer_label || (v.customer_id ? "Seçili müşteri" : "Seçilmedi"), muted: !v.customer_id }],
    },
    {
      id: "portfoy",
      label: "Portföy",
      description: "Önerilenler müşterinin talebine ve açık işlerine göre sıralanır.",
      icon: Home,
      validate: (v) =>
        dealMissing({ ...v, deal_value: "x" }).map((i) => ({ field: i.field, message: "Müşteri ya da portföyden en az birini seçin." })),
      summary: (v) => [
        { label: "Portföy", value: v.property_label || (v.property_id ? "Seçili portföy" : "Seçilmedi"), muted: !v.property_id },
        ...(v.property_code ? [{ label: "Kod", value: v.property_code }] : []),
        { label: "Liste fiyatı", value: money(v.list_price) ?? "—", muted: !money(v.list_price) },
      ],
    },
    {
      id: "fiyat",
      label: "Fiyat ve komisyon",
      short: "Fiyat",
      description: "Konuşulan tutar, aşama ve komisyon. Hesap sağ panelde canlı güncellenir.",
      icon: Banknote,
      validate: (v) => {
        const issues = fiyatValidate(v);
        if (v.stage === "negotiation") {
          if (v.has_authority !== "1") issues.push({ field: "wz-deal-authority", message: `${o.stageName("negotiation")} aşaması için yazılı yetki belgesi gerekir.` });
          if (!v.customer_id || !v.property_id) issues.push({ field: "wz-deal-stage", message: `${o.stageName("negotiation")} aşaması için müşteri ve portföy birlikte seçilmeli.` });
        }
        for (const cf of o.requiredCustomFields) {
          if (!hasValue(v[cf.name])) issues.push({ field: cf.fieldId, message: `${cf.label} zorunlu.` });
        }
        return issues;
      },
      summary: (v) => {
        const value = parseMoney(v.deal_value);
        const list = parseMoney(v.list_price);
        const rate = effectiveRate(v);
        const p = salePreview(value, rate, o.splits);
        return [
          { label: "Tür", value: dealTypeLabel(v.deal_type) },
          { label: "Aşama", value: o.stageName(v.stage || "new") },
          { label: "Tutar", value: value != null ? formatTry(value) : "Girilmedi", muted: value == null },
          ...(value != null && list ? [{ label: "Liste fiyatına oran", value: `%${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format((value / list) * 100)}` }] : []),
          { label: "Komisyon oranı", value: rate != null ? `%${String(rate).replace(".", ",")}` : "Tanımlı değil", muted: rate == null },
          ...(p ? [{ label: "Komisyon (KDV hariç)", value: formatTry(p.net) }] : []),
          { label: "Yetki belgesi", value: v.has_authority === "1" ? "Onaylı" : "Onaylı değil", muted: v.has_authority !== "1" },
        ];
      },
    },
    {
      id: "teklif",
      label: "Belgeler ve teklif",
      short: "Teklif",
      description: "İsterseniz alıcının teklifini şimdi kaydedin; evrak dosyası anlaşma açılınca hazır olur.",
      icon: FileText,
      optional: true,
      when: () => o.canOffer,
      validate: (v) => {
        if (v.teklif !== "1") return [];
        const out = [];
        if (!v.property_id) out.push({ field: "wz-offer-toggle", message: "Teklif için portföy seçin (Portföy adımı)." });
        if (parseMoney(v.offer_amount) == null) out.push({ field: "wz-offer-amount", message: "Teklif tutarını girin." });
        if (v.offer_valid_until && v.offer_valid_until < o.today) out.push({ field: "wz-offer-until", message: "Teklif son tarihi geçmişte olamaz." });
        return out;
      },
      summary: (v) =>
        v.teklif === "1"
          ? [
              { label: "Teklif", value: money(v.offer_amount) ?? "Tutar yok" },
              { label: "Son tarih", value: v.offer_valid_until ? v.offer_valid_until.split("-").reverse().join(".") : "Belirtilmedi", muted: !v.offer_valid_until },
            ]
          : [{ label: "Teklif", value: "Kaydedilmeyecek", muted: true }],
    },
  ];
}

/** Başlangıç adımı: taraflar bağlamdan geldiyse doğrudan sonraki adım. */
export function saleInitialStep(v: WizardValues): string {
  if (v.customer_id && v.property_id) return "fiyat";
  if (v.customer_id) return "portfoy";
  return "musteri";
}

export type SaleActions = {
  createDeal: (fd: FormData) => Promise<{ ok?: boolean; error?: string; dealId?: string }>;
  setRate: (propertyId: string, rate: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  createOffer: (fd: FormData) => Promise<{ ok?: boolean; error?: string; id?: string }>;
};

/** Onayla: anlaşma → (oran eksikse) portföy oranı → (istenirse) teklif. Her görev MEVCUT action. */
export function salePlan(v: WizardValues, skipped: ReadonlySet<string>, actions: SaleActions, customFieldNames: readonly string[]): PlanTask[] {
  const tasks: PlanTask[] = [
    {
      id: "anlasma",
      label: "Anlaşma kaydı",
      run: async (): Promise<TaskOutcome> => {
        const res = await actions.createDeal(toFormData(v, [...DEAL_ACTION_FIELDS, ...customFieldNames]));
        if (res.error || !res.dealId) return { ok: false, error: res.error ?? "Anlaşma oluşturulamadı." };
        return { ok: true, patch: { dealId: res.dealId } };
      },
    },
  ];
  if (v.property_id && !parsePercent(v.property_rate) && parsePercent(v.commission_rate) != null) {
    tasks.push({
      id: "oran",
      label: "Portföy komisyon oranı",
      run: async () => {
        const res = await actions.setRate(v.property_id, v.commission_rate);
        return res.ok ? { ok: true } : { ok: false, error: res.error };
      },
    });
  }
  if (v.teklif === "1" && !skipped.has("teklif") && v.property_id) {
    tasks.push({
      id: "teklif",
      label: "Teklif kaydı",
      run: async () => {
        const fd = new FormData();
        fd.set("property_id", v.property_id);
        if (v.customer_id) fd.set("customer_id", v.customer_id);
        fd.set("amount", v.offer_amount ?? "");
        if (v.offer_valid_until) fd.set("valid_until", v.offer_valid_until);
        const res = await actions.createOffer(fd);
        return res.error ? { ok: false, error: res.error } : { ok: true, note: "Teklif kaydedildi." };
      },
    });
  }
  return tasks;
}

