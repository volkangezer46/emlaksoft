import { financePath } from "@/lib/finance/routes";
import type { ReactNode } from "react";
import Link from "@/components/ui/smart-link";
import { CalendarCheck, ScanLine, Settings2, Tags, Wand2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { formatDateTimeTr } from "@/lib/format";
import { now, trMonthKey } from "@/lib/clock";
import { getDefinitionsOrDefault } from "@/lib/definitions";
import { CASH_CATEGORIES, SALARY_CATEGORY } from "@/lib/finance/cash/categories";
import { addMonths, monthBounds } from "@/lib/finance/expense-budget";
import type { ManagedCategory, SystemCategory } from "../ayarlar/category-manager";
import type { PeriodRow } from "../ayarlar/period-locks";
import type { FinanceRuleRow, RuleCategoryOption, RulePartyChoice } from "../ayarlar/rules-list";
import type { FinanceSettingsValue } from "../ayarlar/settings-form";
import { CategoryManager, FinanceSettingsForm, PeriodLocks, RulesList } from "../_lazy";
import { ReceiptSettingsSection } from "@/components/finance/receipt/receipt-settings-section";
import { PARTY_KIND_LABEL, categoryLabelMap, loadCustomCategories, monthLabelOf, type FinanceTabProps } from "./butce";

/** Dönem kapanışında listelenen ay sayısı (bu ay dahil geriye). */
const LOCK_MONTHS = 12;

const DEFAULT_SETTINGS: FinanceSettingsValue = { defaultVatRate: 20, vatIncludedDefault: true, ocrEnabled: false, forecastMinBalance: null };

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Ayarlar sekmesi (?sekme=ayarlar): genel muhasebe ayarları (KDV varsayılanı, fiş okuma, nakit uyarı eşiği), ofis
 * kategorileri, otomatik kategori kuralları ve dönem kapanışı (ay kilidi; kilidi açma yalnız ofis sahibi ve genel müdür).
 */
export async function AyarlarTab({ tenantId, canEdit, canSalary, isOwnerGm }: FinanceTabProps) {
  const supabase = await createClient();
  const current = trMonthKey(now());
  const oldest = addMonths(current, -(LOCK_MONTHS - 1));

  const [settingsRes, custom, defs, rulesRes, locksRes, partiesRes] = await Promise.all([
    supabase.from("finance_settings").select("default_vat_rate, vat_included_default, ocr_enabled, forecast_min_balance").maybeSingle(),
    loadCustomCategories(supabase),
    getDefinitionsOrDefault("expense_category"),
    supabase
      .from("finance_rules")
      .select("id, direction, match_text, match_iban_last4, amount_min, amount_max, set_category, set_party_id, mode, active, hits")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("finance_period_locks").select("period_month, locked_at, locked_by, note").gte("period_month", `${oldest}-01`).order("period_month", { ascending: false }),
    supabase.from("finance_parties").select("id, name, kind").is("archived_at", null).order("name", { ascending: true }).limit(500),
  ]);

  // Şema (FN1) yoksa tüm bölümler "kurulum bekliyor" der; sekme hata vermez.
  const schemaReady = custom.available && !settingsRes.error;
  if (!schemaReady) {
    return (
      <Alert tone="info" title="Muhasebe ayarları kurulum bekliyor">
        Ofis kategorileri, otomatik kurallar ve dönem kapanışı muhasebe güncellemesi uygulanınca açılır.
      </Alert>
    );
  }

  const s = settingsRes.data as Record<string, unknown> | null;
  const settings: FinanceSettingsValue = s
    ? {
        defaultVatRate: num(s.default_vat_rate) ?? DEFAULT_SETTINGS.defaultVatRate,
        vatIncludedDefault: s.vat_included_default !== false,
        ocrEnabled: s.ocr_enabled === true,
        forecastMinBalance: num(s.forecast_min_balance),
      }
    : DEFAULT_SETTINGS;

  const labels = categoryLabelMap(defs, custom.rows);
  const entriesHref = (category: string, dir: "in" | "out") => `${financePath("hareketler")}?tur=${dir === "in" ? "gelir" : "gider"}&kategori=${encodeURIComponent(category)}`;

  const system: SystemCategory[] = CASH_CATEGORIES.filter((c) => canSalary || c.value !== SALARY_CATEGORY).map((c) => ({ value: c.value, label: c.label, direction: c.direction, href: entriesHref(c.value, c.direction) }));
  const managed: ManagedCategory[] = custom.rows.map((c) => ({
    id: c.id,
    direction: c.direction,
    key: c.key,
    label: c.label,
    defaultVatRate: c.default_vat_rate,
    defaultWithholdingRate: c.default_withholding_rate,
    expenseCategory: c.expense_category,
    archived: Boolean(c.archived_at),
    href: entriesHref(c.key, c.direction),
  }));

  const parties = ((partiesRes.error ? [] : partiesRes.data) ?? []) as { id: string; name: string; kind: string }[];
  const partyName = new Map(parties.map((p) => [p.id, p.name]));
  const partyChoices: RulePartyChoice[] = parties.map((p) => ({ value: p.id, label: p.name, hint: PARTY_KIND_LABEL[p.kind] ?? "Kişi / firma" }));
  const ruleCategories: RuleCategoryOption[] = [
    ...CASH_CATEGORIES.filter((c) => canSalary || c.value !== SALARY_CATEGORY).map((c) => ({ value: c.value, label: c.label, direction: c.direction })),
    ...custom.rows.filter((c) => !c.archived_at).map((c) => ({ value: c.key, label: c.label, direction: c.direction })),
  ];
  const rules: FinanceRuleRow[] = ((rulesRes.error ? [] : rulesRes.data) ?? []).map((r: Record<string, unknown>) => {
    const setPartyId = (r.set_party_id as string | null) ?? null;
    const setCategory = String(r.set_category ?? "");
    return {
      id: String(r.id),
      direction: r.direction === "in" || r.direction === "out" ? r.direction : null,
      matchText: (r.match_text as string | null) ?? null,
      matchIbanLast4: (r.match_iban_last4 as string | null) ?? null,
      amountMin: num(r.amount_min),
      amountMax: num(r.amount_max),
      setCategory,
      setCategoryLabel: labels.get(setCategory) ?? setCategory,
      setPartyId,
      setPartyLabel: setPartyId ? (partyName.get(setPartyId) ?? null) : null,
      mode: r.mode === "auto" ? "auto" : "suggest",
      active: r.active !== false,
      hits: Number(r.hits ?? 0) || 0,
    };
  });

  const locks = new Map(
    ((locksRes.error ? [] : locksRes.data) ?? []).map((l: Record<string, unknown>) => [
      String(l.period_month ?? "").slice(0, 7),
      { lockedAt: l.locked_at ? formatDateTimeTr(String(l.locked_at)) : null, lockedBy: (l.locked_by as string | null) ?? null, note: (l.note as string | null) ?? null },
    ]),
  );
  const lockerIds = [...new Set([...locks.values()].map((l) => l.lockedBy).filter((x): x is string => Boolean(x)))];
  const lockerNames = new Map<string, string>();
  if (lockerIds.length > 0) {
    const { data } = await supabase.from("profiles").select("id, full_name").eq("tenant_id", tenantId).in("id", lockerIds);
    for (const p of (data ?? []) as { id: string; full_name: string | null }[]) lockerNames.set(p.id, p.full_name ?? "Kullanıcı");
  }
  const periodRows: PeriodRow[] = Array.from({ length: LOCK_MONTHS }, (_, i) => addMonths(current, -i)).map((key) => {
    const l = locks.get(key);
    const b = monthBounds(key);
    return {
      key,
      label: monthLabelOf(key),
      locked: Boolean(l),
      lockedAt: l?.lockedAt ?? null,
      lockedBy: l?.lockedBy ? (lockerNames.get(l.lockedBy) ?? null) : null,
      note: l?.note ?? null,
      href: `${financePath("hareketler")}?from=${b.from}&to=${b.to}`,
    };
  });

  return (
    <div className="grid gap-5">
      <nav aria-label="Ayar bölümleri" className="flex flex-wrap gap-2 text-xs">
        {[
          { href: "#genel", label: "Genel" },
          { href: "#kategoriler", label: "Kategoriler" },
          { href: "#kurallar", label: "Otomatik kurallar" },
          { href: "#donem", label: "Dönem kapanışı" },
        ].map((a) => (
          <Link key={a.href} href={a.href} className="focus-ring press inline-flex min-h-8 items-center rounded-full border border-line bg-surface px-3 font-semibold text-text-muted hover:text-ink-950 touch:min-h-11">
            {a.label}
          </Link>
        ))}
      </nav>

      <Section id="genel" icon={<Settings2 className="h-4 w-4 text-brand-600" aria-hidden />} title="Genel ayarlar" description="KDV varsayılanı ve nakit akışı uyarısı.">
        <FinanceSettingsForm value={settings} canEdit={canEdit} />
      </Section>
      <Section id="fis-okuma" icon={<ScanLine className="h-4 w-4 text-brand-600" aria-hidden />} title="Fiş okuma" description="Yüklenen fiş ve faturadan bilgi önerisi; katmanlar ve verinin nereye gittiği.">
        <ReceiptSettingsSection tenantId={tenantId} canEdit={canEdit} />
      </Section>

      <Section id="kategoriler" icon={<Tags className="h-4 w-4 text-brand-600" aria-hidden />} title="Kategoriler" description="Sistem kategorileri sabittir; ofisinize özel kategori ekleyebilir, varsayılan KDV ve stopajını belirleyebilirsiniz.">
        <CategoryManager system={system} custom={managed} expenseCategories={defs.map((d) => ({ value: d.value, label: d.label }))} canEdit={canEdit} />
      </Section>

      <Section id="kurallar" icon={<Wand2 className="h-4 w-4 text-brand-600" aria-hidden />} title="Otomatik kurallar" description="Banka ekstresi ve yeni kayıtlarda koşula uyan satıra kategori ve kişi/firma önerilir ya da otomatik atanır.">
        {rulesRes.error ? <Alert tone="warning">Kurallar şu an yüklenemedi; sayfayı yenileyin.</Alert> : <RulesList rules={rules} categories={ruleCategories} parties={partyChoices} canEdit={canEdit} />}
      </Section>

      <Section
        id="donem"
        icon={<CalendarCheck className="h-4 w-4 text-brand-600" aria-hidden />}
        title="Dönem kapanışı"
        description="Muhasebeciye teslim edilen ayı kilitleyin: o aya kayıt eklenemez, değiştirilemez. Kilidi yalnız ofis sahibi ve genel müdür açabilir."
      >
        {locksRes.error ? (
          <Alert tone="warning">Dönem kilitleri şu an yüklenemedi; sayfayı yenileyin.</Alert>
        ) : (
          <PeriodLocks rows={periodRows} canLock={canEdit} canUnlock={isOwnerGm} />
        )}
      </Section>
    </div>
  );
}

function Section({ id, icon, title, description, children }: { id: string; icon: ReactNode; title: string; description: string; children: ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-24">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">{icon} {title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
