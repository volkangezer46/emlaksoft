"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { parseMoneyInput } from "@/lib/money-input";
import { now, trDayKey } from "@/lib/clock";
import { revalidateTenantData } from "@/lib/revalidate";
import { canHandleSalary } from "@/lib/finance/cash/categories";
import { PORTAL_KEYS, PORTAL_LABEL, type PortalKey } from "@/lib/finance/portal-roi";
import { loadRecurringRules } from "@/lib/finance/recurring/load";
import { createFinanceAccount } from "@/app/actions/finance-accounts";
import { createRecurringRule } from "@/app/actions/recurring-rules";

/**
 * Kurulum sihirbazı "Giderler ve kasa" adımı: ofis kasası/banka açılışı + düzenli ödemeler tek tıkla toplu kurulur.
 * Geçmişe dönük kayıt YOK (her kural bugünden ileri ilk vadeden başlar); atlanabilir; tekrar çalıştırmak aynı ödemeyi iki kez açmaz.
 * Yetki: `expenses:create` (maaş satırı yalnız owner/gm). Asıl yazma finance_account_create / recurring_rule_create RPC'leridir.
 */
export type ExpensesCashSetupInput = {
  /** "rent" = kira öderiz, "own" = kendi işyerimiz (kira yok), "skip" = dokunma. */
  workplace?: "rent" | "own" | "skip";
  rentAmount?: string;
  rentPeriod?: "monthly" | "yearly";
  rentDay?: string;
  /** Yıllık kira için ödeme ayı (1-12). */
  rentMonth?: string;
  accountingAmount?: string;
  accountingDay?: string;
  sgkAmount?: string;
  sgkDay?: string;
  /** portal anahtarı -> aylık tutar (boş = üyelik yok). */
  portals?: Partial<Record<PortalKey, string>>;
  portalDay?: string;
  salaryAmount?: string;
  salaryDay?: string;
  cashOpening?: string;
  bankName?: string;
  bankOpening?: string;
  mode?: "auto" | "approve";
};

export type ExpensesCashSetupResult = { ok?: boolean; error?: string; created?: number; skipped?: number; failed?: string[] };

const CASH_NAME = "Ofis kasası";

function amountOf(v: string | undefined): number | null {
  if (v == null || v.trim() === "") return null;
  const p = parseMoneyInput(v, { max: 9_999_999_999.99 });
  return p.ok && p.value != null && p.value > 0 ? p.value : null;
}

function dayOf(v: string | undefined, fallback = 1): number {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 31 ? n : fallback;
}

export async function saveExpensesCashSetup(input: ExpensesCashSetupInput): Promise<ExpensesCashSetupResult> {
  const gate = await requirePermission("expenses", "create");
  if (!gate.ok) return { error: gate.error };
  const today = trDayKey(now());
  const supabase = await createClient();
  const mode = input.mode === "approve" ? "approve" : "auto";

  // --- Hesaplar: aynı adlı ofis hesabı varsa yeniden kullanılır (tekrar çalıştırma güvenli) ---
  const { data: accRows, error: accErr } = await supabase
    .from("finance_accounts")
    .select("id, name, kind")
    .eq("owner_scope", "office")
    .is("archived_at", null);
  if (accErr) return { error: "Kasa ve banka için veritabanı güncellemesi henüz uygulanmamış." };
  const existing = (accRows ?? []) as { id: string; name: string; kind: string }[];
  const failed: string[] = [];
  const findByName = (name: string) => existing.find((a) => a.name.trim().toLocaleLowerCase("tr-TR") === name.trim().toLocaleLowerCase("tr-TR"));

  let cashId: string | null = null;
  let bankId: string | null = null;
  const cashOpening = input.cashOpening != null && input.cashOpening.trim() !== "" ? input.cashOpening : null;
  if (cashOpening != null) {
    const found = findByName(CASH_NAME);
    if (found) cashId = found.id;
    else {
      const res = await createFinanceAccount({ scope: "office", kind: "cash", name: CASH_NAME, currency: "TRY", openingBalance: cashOpening, openingDate: today });
      if (res.error) failed.push(`${CASH_NAME}: ${res.error}`);
      else cashId = res.id ?? null;
    }
  }
  const bankName = (input.bankName ?? "").trim();
  if (bankName) {
    const found = findByName(bankName);
    if (found) bankId = found.id;
    else {
      const res = await createFinanceAccount({ scope: "office", kind: "bank", name: bankName, currency: "TRY", openingBalance: input.bankOpening ?? "0", openingDate: today });
      if (res.error) failed.push(`${bankName}: ${res.error}`);
      else bankId = res.id ?? null;
    }
  }
  // Ödemelerin yazılacağı hesap: yeni banka > yeni kasa > var olan ilk ofis hesabı.
  const payFrom = bankId ?? cashId ?? existing[0]?.id ?? null;

  // --- Kurallar ---
  type Planned = { category: string; title: string; amount: number; payDay: number; frequency: "monthly" | "yearly"; startMonth?: string; portalKey?: PortalKey };
  const planned: Planned[] = [];
  if (input.workplace === "rent") {
    const amount = amountOf(input.rentAmount);
    if (amount) {
      const yearly = input.rentPeriod === "yearly";
      let startMonth: string | undefined;
      if (yearly) {
        const m = Math.min(Math.max(Math.trunc(Number(input.rentMonth)) || Number(today.slice(5, 7)), 1), 12);
        const year = m >= Number(today.slice(5, 7)) ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) + 1;
        startMonth = `${year}-${String(m).padStart(2, "0")}`;
      }
      planned.push({ category: "kira", title: "Ofis kirası", amount, payDay: dayOf(input.rentDay), frequency: yearly ? "yearly" : "monthly", startMonth });
    }
  }
  const accounting = amountOf(input.accountingAmount);
  if (accounting) planned.push({ category: "muhasebe", title: "Muhasebe ücreti", amount: accounting, payDay: dayOf(input.accountingDay), frequency: "monthly" });
  const sgk = amountOf(input.sgkAmount);
  if (sgk) planned.push({ category: "sgk", title: "SGK", amount: sgk, payDay: dayOf(input.sgkDay, 26), frequency: "monthly" });
  for (const key of PORTAL_KEYS) {
    const amount = amountOf(input.portals?.[key]);
    if (amount) planned.push({ category: "portal", title: `${PORTAL_LABEL[key]} üyeliği`, amount, payDay: dayOf(input.portalDay), frequency: "monthly", portalKey: key });
  }
  const salary = amountOf(input.salaryAmount);
  if (salary && canHandleSalary(gate.role)) planned.push({ category: "maas", title: "Maaşlar", amount: salary, payDay: dayOf(input.salaryDay, 1), frequency: "monthly" });

  let created = 0;
  let skipped = 0;
  if (planned.length > 0 && !payFrom) {
    return { error: "Ödemelerin yazılacağı bir hesap yok. Kasa açılış bakiyesini veya banka adını da girin.", failed };
  }
  if (planned.length > 0 && payFrom) {
    const { rules } = await loadRecurringRules(supabase, { scope: "office" });
    const has = (p: Planned) => rules.some((r) => r.category === p.category && r.title.trim().toLocaleLowerCase("tr-TR") === p.title.trim().toLocaleLowerCase("tr-TR"));
    for (const p of planned) {
      if (has(p)) {
        skipped += 1;
        continue;
      }
      const res = await createRecurringRule({
        accountId: payFrom,
        direction: "out",
        category: p.category,
        title: p.title,
        amount: String(p.amount),
        frequency: p.frequency,
        payDay: p.payDay,
        startMonth: p.startMonth,
        portalKey: p.portalKey,
        mode,
      });
      if (res.error) failed.push(`${p.title}: ${res.error}`);
      else created += 1;
    }
  }

  revalidateTenantData(gate.tenantId, ["/app/giderler", "/app/baslangic", "/app"]);
  if (failed.length > 0 && created === 0 && skipped === 0 && !cashId && !bankId) return { error: failed[0], failed };
  return { ok: true, created, skipped, failed };
}
