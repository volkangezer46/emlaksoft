/**
 * Kiralama sihirbazı (/app/kiralama/yeni) — adımlar, doğrulama, özet ve gönderim planı (SAF; IO yalnız enjekte edilen
 * action'larda). İş kuralı MEVCUT action'larda kalır:
 *   · `createCustomer` (hızlı kiracı kaydı; telefon `parsePhoneStrict`, mükerrer kapısı),
 *   · `updatePropertyCommissionRate` (kira kapanışı portföy oranı ister),
 *   · `createRental` → `create_rental_atomic` (kira + kiralık anlaşma "kazanıldı" + komisyon + portföy "Kiralandı";
 *     onaylı başvuru bağlanır, kefil taşınır),
 *   · `createRentCharge` (ilk tahakkuk), `saveInspection` (teslim tutanağı taslağı), `setRentalProcessStep` (anahtar,
 *     abonelik).
 * Artış kuralı ve aidat için ayrı sütun yok: kira kaydının NOTUNA koşul satırı olarak yazılır (`rentTermLines`).
 */
import { FileSignature, Home, KeyRound, UserRound } from "lucide-react";
import * as z from "zod/mini";
import { formatTry } from "@/lib/format";
import { DEFAULT_KEYS, defaultRooms } from "@/lib/rentals/inspection";
import { INCREASE_RULES, moveInTotals, parseMoney, parsePercent, rentTermLines } from "@/lib/sihirbaz/hesap";
import { parseWithholdingRate } from "@/lib/rent-withholding";
import type { PlanTask, TaskOutcome, WizardStep, WizardValues } from "@/components/ui/wizard/engine";
import { zodStep } from "@/components/ui/wizard/zod-step";

export const RENT_WIZARD_ID = "kira";

/** Taslak: kimlikler, tutarlar, tarihler, seçimler. Kiracı adı/telefonu/e-postası ve not YAZILMAZ. */
export const RENT_DRAFT_FIELDS = [
  "property_id",
  "property_label",
  "property_rate",
  "list_price",
  "renter_mode",
  "renter_customer_id",
  "application_id",
  "monthly_rent",
  "due_day",
  "deposit",
  "dues",
  "start_date",
  "end_date",
  "usage",
  "withholding_rate",
  "increase_rule",
  "increase_fixed",
  "commission_rate",
  "tenant_pays_fee",
  "first_charge",
  "inspection_on",
  "inspected_on",
  "meter_electricity",
  "meter_water",
  "meter_gas",
  "key_0",
  "key_1",
  "key_2",
  "keys_handed",
  "utilities_done",
] as const;

export type RentStepOptions = {
  canSetRate: boolean;
  canCreateCustomer: boolean;
  /** Teslim adımı (rentals:edit). */
  canHandover: boolean;
};

/** Etkin komisyon oranı: portföyde varsa o, yoksa girilen. */
export function rentRate(v: WizardValues): number | null {
  return parsePercent(v.property_rate) ?? parsePercent(v.commission_rate);
}

export function rentTotals(v: WizardValues) {
  return moveInTotals({
    rent: parseMoney(v.monthly_rent),
    deposit: parseMoney(v.deposit),
    dues: parseMoney(v.dues),
    commissionRate: rentRate(v),
    tenantPaysCommission: v.tenant_pays_fee === "1",
  });
}

const dayLabel = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split("-").reverse().join(".") : null);

export function rentSteps(o: RentStepOptions): WizardStep[] {
  const kosulValidate = zodStep(
    z.object({
      monthly_rent: z.string().check(z.refine((s) => parseMoney(s) != null, { message: "Aylık kirayı girin." })),
      due_day: z.string().check(
        z.refine((s) => /^\d{1,2}$/.test(s.trim()) && Number(s) >= 1 && Number(s) <= 28, { message: "Vade günü 1 ile 28 arasında olmalı." }),
      ),
      start_date: z.string().check(z.refine((s) => /^\d{4}-\d{2}-\d{2}$/.test(s), { message: "Başlangıç tarihini seçin." })),
      withholding_rate: z.string().check(z.refine((s) => parseWithholdingRate(s) != null, { message: "Stopaj oranı 0 ile 50 arasında olmalı." })),
    }),
    { fieldIds: { monthly_rent: "wz-rent-amount", due_day: "wz-rent-due", start_date: "wz-rent-start", withholding_rate: "wz-rent-wh" } },
  );

  return [
    {
      id: "mulk",
      label: "Mülk",
      description: "Kiralanacak portföy. Kira kaydı açılınca portföy “Kiralandı” olur.",
      icon: Home,
      validate: (v) => {
        const out = [];
        if (!v.property_id) out.push({ field: "wz-rent-property", message: "Portföy seçin." });
        else if (rentRate(v) == null) {
          out.push({
            field: "wz-rent-rate",
            message: o.canSetRate ? "Portföyde komisyon oranı yok; oranı girin (ör. 100 = bir aylık kira)." : "Portföyde komisyon oranı yok; portföy sorumlusu oranı girmeli.",
          });
        }
        if (v.commission_rate && parsePercent(v.commission_rate) == null) out.push({ field: "wz-rent-rate", message: "Oran 0'dan büyük, en çok 100 ve en çok iki ondalık olmalı." });
        return out;
      },
      summary: (v) => [
        { label: "Portföy", value: v.property_label || "Seçilmedi", muted: !v.property_label },
        { label: "Komisyon oranı", value: rentRate(v) != null ? `%${String(rentRate(v)).replace(".", ",")}` : "Yok", muted: rentRate(v) == null },
      ],
    },
    {
      id: "kiraci",
      label: "Kiracı",
      description: "Mevcut müşteri, hızlı yeni kayıt ya da onaylı kiracı başvurusu.",
      icon: UserRound,
      validate: (v) => {
        if (v.renter_mode === "yeni") {
          const out = [];
          if (!(v.renter_name ?? "").trim()) out.push({ field: "wz-renter-name", message: "Kiracının adını soyadını yazın." });
          if (!(v.renter_phone ?? "").trim()) out.push({ field: "wz-renter-phone", message: "Kiracının telefonunu girin." });
          return out;
        }
        return v.renter_customer_id ? [] : [{ field: v.renter_mode === "basvuru" ? "wz-renter-app" : "wz-renter", message: "Kiracıyı seçin." }];
      },
      summary: (v) => [
        {
          label: "Kiracı",
          value: v.renter_mode === "yeni" ? `${v.renter_name || "—"} (yeni kayıt)` : v.renter_label || (v.renter_customer_id ? "Seçili müşteri" : "Seçilmedi"),
          muted: v.renter_mode !== "yeni" && !v.renter_customer_id,
        },
        ...(v.application_id ? [{ label: "Kaynak", value: "Onaylı kiracı başvurusu (kefil taşınır)" }] : []),
      ],
    },
    {
      id: "kosullar",
      label: "Kira koşulları",
      short: "Koşullar",
      description: "Bedel, vade, depozito, artış kuralı, aidat ve süre. Taşınma maliyeti sağda canlı hesaplanır.",
      icon: FileSignature,
      validate: (v) => {
        const out = kosulValidate(v);
        if (v.deposit && parseMoney(v.deposit) == null && v.deposit.trim() !== "0") out.push({ field: "wz-rent-deposit", message: "Geçerli bir depozito tutarı girin." });
        if (v.end_date && v.start_date && v.end_date <= v.start_date) out.push({ field: "wz-rent-end", message: "Bitiş tarihi başlangıçtan sonra olmalı." });
        if (v.increase_rule === "sabit" && parsePercent(v.increase_fixed) == null) out.push({ field: "wz-rent-inc-fixed", message: "Yıllık artış oranını yazın." });
        if ((v.notes ?? "").length > 4500) out.push({ field: "wz-rent-notes", message: "Not en fazla 4500 karakter olabilir." });
        return out;
      },
      summary: (v) => {
        const rent = parseMoney(v.monthly_rent);
        const rule = INCREASE_RULES.find((r) => r.value === v.increase_rule);
        return [
          { label: "Aylık kira", value: rent != null ? formatTry(rent) : "Girilmedi", muted: rent == null },
          { label: "Vade günü", value: v.due_day ? `Ayın ${v.due_day}. günü` : "—" },
          { label: "Depozito", value: parseMoney(v.deposit) != null ? formatTry(parseMoney(v.deposit) ?? 0) : "Yok", muted: parseMoney(v.deposit) == null },
          { label: "Aidat", value: parseMoney(v.dues) != null ? `${formatTry(parseMoney(v.dues) ?? 0)} / ay` : "Yok", muted: parseMoney(v.dues) == null },
          { label: "Artış", value: v.increase_rule === "sabit" && v.increase_fixed ? `Yıllık %${v.increase_fixed}` : (rule?.label ?? "—") },
          { label: "Süre", value: `${dayLabel(v.start_date) ?? "—"} – ${dayLabel(v.end_date) ?? "süresiz"}` },
          { label: "Kullanım", value: v.usage === "isyeri" ? `İşyeri · stopaj %${v.withholding_rate || "0"}` : "Konut" },
        ];
      },
    },
    {
      id: "teslim",
      label: "Teslim",
      description: "Sayaç değerleri ve anahtarlar. Teslim tutanağı taslağı açılır; odaları tutanak ekranında işaretlersiniz.",
      icon: KeyRound,
      optional: true,
      when: () => o.canHandover,
      validate: (v) =>
        v.inspection_on === "1" && !/^\d{4}-\d{2}-\d{2}$/.test(v.inspected_on ?? "") ? [{ field: "wz-hand-date", message: "Tutanak tarihini seçin." }] : [],
      summary: (v) => [
        { label: "Teslim tutanağı", value: v.inspection_on === "1" ? `Taslak (${dayLabel(v.inspected_on) ?? "—"})` : "Açılmayacak", muted: v.inspection_on !== "1" },
        { label: "Anahtar teslimi", value: v.keys_handed === "1" ? "Yapıldı" : "Sonra", muted: v.keys_handed !== "1" },
        { label: "Abonelik devri", value: v.utilities_done === "1" ? "Yapıldı" : "Sonra", muted: v.utilities_done !== "1" },
      ],
    },
  ];
}

/** Bağlamdan gelindiyse (portföy + kiracı) doğrudan koşullara; yalnız portföy → kiracı. */
export function rentInitialStep(v: WizardValues): string {
  if (v.property_id && rentRate(v) != null && v.renter_customer_id) return "kosullar";
  if (v.property_id && rentRate(v) != null) return "kiraci";
  return "mulk";
}

export type RentActions = {
  createCustomer: (fd: FormData) => Promise<{ ok?: boolean; error?: string; id?: string; duplicate?: boolean }>;
  setRate: (propertyId: string, rate: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  createRental: (fd: FormData) => Promise<{ ok?: boolean; error?: string; id?: string }>;
  createCharge: (rentalId: string, month: string) => Promise<{ ok?: boolean; error?: string }>;
  saveInspection: (input: { rentalId: string; kind: string; inspectedOn: string; rooms: unknown; meters: unknown; keys: unknown; notes: string }) => Promise<{ ok?: boolean; error?: string }>;
  markStep: (rentalId: string, step: string, done: boolean) => Promise<{ ok?: boolean; error?: string }>;
};

/** Kira notu: kullanıcının notu + koşul satırları (artış kuralı, aidat). */
export function rentalNotes(v: WizardValues): string {
  const lines = rentTermLines({ rule: v.increase_rule ?? "", fixedRate: v.increase_fixed ?? "", dues: parseMoney(v.dues), formatMoney: formatTry });
  return [(v.notes ?? "").trim(), ...lines].filter(Boolean).join("\n");
}

/**
 * Onayla: (yeni kiracı) müşteri → (oran yoksa) portföy oranı → KİRA KAYDI (atomik) → ilk tahakkuk → (teslim) tutanak
 * taslağı, anahtar, abonelik. Kiracı önce: mükerrer telefon uyarısında hiçbir kayıt açılmamış olur ve kullanıcı mevcut
 * müşteriyi seçebilir.
 */
export function rentPlan(v: WizardValues, skipped: ReadonlySet<string>, o: RentStepOptions, a: RentActions): PlanTask[] {
  const tasks: PlanTask[] = [];
  if (v.renter_mode === "yeni") {
    tasks.push({
      id: "kiraci",
      label: "Kiracı müşteri kaydı",
      run: async (): Promise<TaskOutcome> => {
        const fd = new FormData();
        fd.set("full_name", v.renter_name ?? "");
        fd.set("phone", v.renter_phone ?? "");
        if (v.renter_email) fd.set("email", v.renter_email);
        fd.set("type", "Kiracı");
        if (v.renter_allow_dup === "1") fd.set("allow_duplicate", "1");
        const res = await a.createCustomer(fd);
        if (res.error || !res.id) {
          return {
            ok: false,
            error: res.duplicate
              ? "Bu telefon ya da e-postayla kayıtlı bir müşteri var. Kiracı adımında mevcut müşteriyi seçin ya da “Yine de yeni kayıt aç”ı işaretleyin."
              : (res.error ?? "Kiracı kaydı açılamadı."),
          };
        }
        return { ok: true, patch: { renterId: res.id } };
      },
    });
  }
  if (v.property_id && !parsePercent(v.property_rate) && parsePercent(v.commission_rate) != null) {
    tasks.push({
      id: "oran",
      label: "Portföy komisyon oranı",
      run: async () => {
        const res = await a.setRate(v.property_id, v.commission_rate);
        return res.ok ? { ok: true } : { ok: false, error: res.error };
      },
    });
  }
  tasks.push({
    id: "kira",
    label: "Kira kaydı, kiralık anlaşma ve portföy durumu",
    run: async (ctx): Promise<TaskOutcome> => {
      const renter = v.renter_mode === "yeni" ? ctx.renterId : v.renter_customer_id;
      if (!renter) return { ok: false, error: "Kiracı bulunamadı." };
      const fd = new FormData();
      fd.set("property_id", v.property_id);
      fd.set("renter_customer_id", renter);
      fd.set("monthly_rent", v.monthly_rent);
      fd.set("due_day", v.due_day);
      fd.set("deposit", v.deposit ?? "");
      fd.set("start_date", v.start_date);
      fd.set("end_date", v.end_date ?? "");
      fd.set("usage", v.usage || "konut");
      fd.set("withholding_rate", v.withholding_rate || "0");
      fd.set("notes", rentalNotes(v));
      if (v.application_id) fd.set("application_id", v.application_id);
      const res = await a.createRental(fd);
      if (res.error || !res.id) return { ok: false, error: res.error ?? "Kira kaydı oluşturulamadı." };
      return { ok: true, patch: { rentalId: res.id } };
    },
  });
  if (v.first_charge === "1") {
    tasks.push({
      id: "tahakkuk",
      label: "İlk kira tahakkuku",
      run: async (ctx) => {
        const res = await a.createCharge(ctx.rentalId ?? "", (v.start_date ?? "").slice(0, 7));
        // Gece tahakkuk işi aynı dönemi önceden açmış olabilir: "zaten var" hata değildir.
        if (res.error && !/zaten var/i.test(res.error)) return { ok: false, error: res.error };
        return { ok: true };
      },
    });
  }
  if (o.canHandover && !skipped.has("teslim")) {
    if (v.inspection_on === "1") {
      tasks.push({
        id: "tutanak",
        label: "Teslim tutanağı taslağı",
        run: async (ctx) => {
          const res = await a.saveInspection({
            rentalId: ctx.rentalId ?? "",
            kind: "move_in",
            inspectedOn: v.inspected_on ?? "",
            rooms: defaultRooms(),
            meters: {
              electricity: { reading: v.meter_electricity ?? "", subscriber: "" },
              water: { reading: v.meter_water ?? "", subscriber: "" },
              gas: { reading: v.meter_gas ?? "", subscriber: "" },
            },
            keys: DEFAULT_KEYS.map((k, i) => ({ label: k.label, count: Number(v[`key_${i}`] ?? k.count) || 0 })),
            notes: "",
          });
          return res.error ? { ok: false, error: res.error } : { ok: true, note: "Teslim tutanağı taslağı açıldı." };
        },
      });
    }
    if (v.keys_handed === "1") {
      tasks.push({
        id: "anahtar",
        label: "Anahtar teslimi",
        run: async (ctx) => {
          const res = await a.markStep(ctx.rentalId ?? "", "keys", true);
          return res.error ? { ok: false, error: res.error } : { ok: true };
        },
      });
    }
    if (v.utilities_done === "1") {
      tasks.push({
        id: "abonelik",
        label: "Abonelik devri",
        run: async (ctx) => {
          const res = await a.markStep(ctx.rentalId ?? "", "utilities", true);
          return res.error ? { ok: false, error: res.error } : { ok: true };
        },
      });
    }
  }
  return tasks;
}
