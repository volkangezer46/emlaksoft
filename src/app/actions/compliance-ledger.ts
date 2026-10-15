"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { now } from "@/lib/clock";
import {
  DEFAULT_LEDGER_THRESHOLDS,
  buildLedgerDraftsFromDeal,
  computeLedgerFlags,
  isMethod,
  computeRetainUntil,
  parseLedgerForm,
  parseRetentionYears,
  parseThreshold,
  type LedgerThresholds,
} from "@/lib/compliance/ledger";
import { actionErrorMessage } from "@/lib/action-errors";

export type LedgerActionResult = { ok?: boolean; error?: string; message?: string };

const MISSING_TABLE = /compliance_ledger|schema cache|does not exist/i;
const MISSING_MSG = "Yasal kayıt defteri bu ortamda henüz etkin değil.";

function isOfficeLevel(role: string) {
  return role === "owner" || role === "gm";
}

type SettingsRow = {
  cash_threshold_try: number | string;
  amount_threshold_try: number | string;
  retention_years: number;
} | null;

function toThresholds(row: SettingsRow): LedgerThresholds {
  if (!row) return DEFAULT_LEDGER_THRESHOLDS;
  return {
    cashThresholdTry: Number(row.cash_threshold_try),
    amountThresholdTry: Number(row.amount_threshold_try),
    retentionYears: Number(row.retention_years),
  };
}

/**
 * Deftere kayıt ekler (yalnız ekleme). Düzeltme = `corrects_entry_id` ile YENİ kayıt.
 * Danışman yalnız kendi adına ekler (created_by oturum kullanıcısına sabit; RLS de zorlar).
 */
export async function addLedgerEntry(
  _prev: LedgerActionResult,
  formData: FormData,
): Promise<LedgerActionResult> {
  const gate = await requirePermission("customers", "create");
  if (!gate.ok) return { error: gate.error };

  const parsed = parseLedgerForm(formData);
  if (!parsed.ok) return { error: parsed.error };
  const v = parsed.value;

  const supabase = await createClient();
  const { data: settings, error: settingsError } = await supabase
    .from("compliance_ledger_settings")
    .select("cash_threshold_try, amount_threshold_try, retention_years")
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (settingsError) {
    console.error("addLedgerEntry settings", settingsError.message);
    return { error: MISSING_TABLE.test(settingsError.message) ? MISSING_MSG : actionErrorMessage(settingsError, "Ayarlar okunamadı.") };
  }
  const thresholds = toThresholds(settings as SettingsRow);

  if (v.correctsEntryId) {
    const { data: original } = await supabase
      .from("compliance_ledger_entries")
      .select("id")
      .eq("id", v.correctsEntryId)
      .eq("tenant_id", gate.tenantId)
      .maybeSingle();
    if (!original) return { error: "Düzeltilecek kayıt bulunamadı veya size ait değil." };
  }
  if (v.customerId) {
    const { data: c } = await supabase
      .from("customers")
      .select("id")
      .eq("id", v.customerId)
      .eq("tenant_id", gate.tenantId)
      .maybeSingle();
    if (!c) return { error: "Müşteri bu ofise ait değil." };
  }
  if (v.propertyId) {
    const { data: p } = await supabase
      .from("properties")
      .select("id")
      .eq("id", v.propertyId)
      .eq("tenant_id", gate.tenantId)
      .maybeSingle();
    if (!p) return { error: "Portföy bu ofise ait değil." };
  }

  const retainUntil = computeRetainUntil(v.transactionDate, thresholds.retentionYears);
  if (!retainUntil) return { error: "İşlem tarihi geçersiz." };
  const flags = computeLedgerFlags(
    { amountTry: v.amountTry, method: v.method, identityChecked: v.identityChecked },
    thresholds,
  );

  const { data, error } = await supabase
    .from("compliance_ledger_entries")
    .insert({
      tenant_id: gate.tenantId,
      kind: v.kind,
      corrects_entry_id: v.correctsEntryId,
      transaction_type: v.transactionType,
      transaction_date: v.transactionDate,
      party_name: v.partyName,
      party_role: v.partyRole,
      counterparty_name: v.counterpartyName,
      identity_checked: v.identityChecked,
      amount_try: v.amountTry,
      payment_method: v.method,
      flags,
      threshold_snapshot: {
        cash_threshold_try: thresholds.cashThresholdTry,
        amount_threshold_try: thresholds.amountThresholdTry,
        retention_years: thresholds.retentionYears,
      },
      note: v.note,
      customer_id: v.customerId,
      property_id: v.propertyId,
      retain_until: retainUntil,
      created_by: gate.userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("addLedgerEntry", error?.message);
    return { error: error && MISSING_TABLE.test(error.message) ? MISSING_MSG : actionErrorMessage(error, "Kayıt eklenemedi.") };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: v.kind === "correction" ? "compliance_ledger.correction" : "compliance_ledger.entry",
    entityType: "compliance_ledger_entry",
    entityId: data.id,
    // Kişisel veri (taraf adı, tutar) denetim kaydına kopyalanmaz.
    newValue: { transaction_type: v.transactionType, flags, corrects: v.correctsEntryId },
  });
  revalidatePath("/app/uyum/kayit-defteri");
  return { ok: true, message: v.kind === "correction" ? "Düzeltme kaydı eklendi." : "Kayıt deftere eklendi." };
}

/** Eşik ve saklama süresi ofis ayarlarını kaydeder (yalnız ofis sahibi / genel müdür). */
export async function saveLedgerSettings(
  _prev: LedgerActionResult,
  formData: FormData,
): Promise<LedgerActionResult> {
  const gate = await requirePermission("compliance", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!isOfficeLevel(gate.role)) return { error: "Ayarları yalnız ofis sahibi veya genel müdür değiştirebilir." };

  const cash = parseThreshold(formData.get("cash_threshold_try"), DEFAULT_LEDGER_THRESHOLDS.cashThresholdTry);
  const amount = parseThreshold(formData.get("amount_threshold_try"), DEFAULT_LEDGER_THRESHOLDS.amountThresholdTry);
  const years = parseRetentionYears(formData.get("retention_years"));
  if (cash === null || amount === null) return { error: "Eşikleri geçerli sayı olarak yazın (0 = işaretleme kapalı)." };
  if (years === null) return { error: "Saklama süresi 1 ile 30 yıl arasında olmalı." };

  const supabase = await createClient();
  const { error } = await supabase.from("compliance_ledger_settings").upsert(
    {
      tenant_id: gate.tenantId,
      cash_threshold_try: cash,
      amount_threshold_try: amount,
      retention_years: years,
      updated_by: gate.userId,
      updated_at: new Date(now()).toISOString(),
    },
    { onConflict: "tenant_id" },
  );
  if (error) {
    console.error("saveLedgerSettings", error.message);
    return { error: MISSING_TABLE.test(error.message) ? MISSING_MSG : actionErrorMessage(error, "Ayarlar kaydedilemedi.") };
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "compliance_ledger.settings",
    entityType: "compliance_ledger_settings",
    entityId: gate.tenantId,
    newValue: { cash_threshold_try: cash, amount_threshold_try: amount, retention_years: years },
  });
  revalidatePath("/app/uyum/kayit-defteri");
  return { ok: true, message: "Ayarlar kaydedildi. Yeni kayıtlar bu eşiklerle işaretlenir; eski kayıtlar değişmez." };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const trDayOf = (iso: string) => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms + 3 * 3_600_000).toISOString().slice(0, 10) : iso.slice(0, 10);
};

/**
 * SP7: kapanmış (kazanılmış) anlaşmadan deftere taraf başına satır yazar — danışman ödeme yöntemini ve her iki taraf
 * için "kimlik aslı görüldü" kutusunu kapanışta onaylar. Kaynak 'auto'; aynı anlaşma + taraf için ikinci satır DB'de
 * engellenir (tekrar deneme güvenli). Defter değiştirilemez; düzeltme yine yeni kayıttır. Kimlik numarası alınmaz.
 * Kapanış sihirbazı da bu eylemi çağırabilir (form alanları: deal_id, payment_method, buyer_identity, seller_identity).
 */
export async function recordDealInLedger(
  _prev: LedgerActionResult,
  formData: FormData,
): Promise<LedgerActionResult> {
  const gate = await requirePermission("customers", "create");
  if (!gate.ok) return { error: gate.error };

  const dealId = String(formData.get("deal_id") ?? "").trim();
  const method = String(formData.get("payment_method") ?? "").trim();
  if (!UUID_RE.test(dealId)) return { error: "Anlaşma bulunamadı." };
  if (!isMethod(method)) return { error: "Ödeme yöntemini seçin." };
  const buyerChecked = formData.get("buyer_identity") === "on";
  const sellerChecked = formData.get("seller_identity") === "on";

  const supabase = await createClient();
  const [dealRes, closedRes, settingsRes] = await Promise.all([
    supabase
      .from("deals")
      .select("id, stage, deal_type, deal_value, property_id, customer_id, updated_at")
      .eq("id", dealId)
      .eq("tenant_id", gate.tenantId)
      .maybeSingle(),
    supabase.from("deals").select("closed_at").eq("id", dealId).eq("tenant_id", gate.tenantId).maybeSingle(),
    supabase
      .from("compliance_ledger_settings")
      .select("cash_threshold_try, amount_threshold_try, retention_years")
      .eq("tenant_id", gate.tenantId)
      .maybeSingle(),
  ]);
  if (settingsRes.error) {
    return { error: MISSING_TABLE.test(settingsRes.error.message) ? MISSING_MSG : actionErrorMessage(settingsRes.error, "Ayarlar okunamadı.") };
  }
  const deal = dealRes.data as {
    id: string;
    stage: string;
    deal_type: "sale" | "rent";
    deal_value: number | string | null;
    property_id: string | null;
    customer_id: string | null;
    updated_at: string;
  } | null;
  if (!deal) return { error: "Anlaşma bulunamadı." };
  if (deal.stage !== "won") return { error: "Yalnız kazanılmış (kapanmış) anlaşma deftere işlenir." };
  const amount = deal.deal_value != null ? Number(deal.deal_value) : 0;
  if (!(amount > 0)) return { error: "Anlaşma değeri girilmemiş; önce anlaşmaya tutar girin ya da kaydı elle ekleyin." };

  // Taraflar: alıcı/kiracı = anlaşma müşterisi; satıcı/ev sahibi = portföyün ilan sahibi kaydı (yoksa yazılmaz).
  const [buyerRes, ownerRes] = await Promise.all([
    deal.customer_id
      ? supabase.from("customers").select("id, full_name").eq("id", deal.customer_id).eq("tenant_id", gate.tenantId).maybeSingle()
      : Promise.resolve({ data: null }),
    deal.property_id
      ? supabase.from("property_owner_info").select("customer_id").eq("property_id", deal.property_id).eq("tenant_id", gate.tenantId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const buyer = buyerRes.data as { id: string; full_name: string | null } | null;
  const ownerCustomerId = (ownerRes.data as { customer_id?: string | null } | null)?.customer_id ?? null;
  const sellerRes = ownerCustomerId
    ? await supabase.from("customers").select("id, full_name").eq("id", ownerCustomerId).eq("tenant_id", gate.tenantId).maybeSingle()
    : { data: null };
  const seller = sellerRes.data as { id: string; full_name: string | null } | null;

  const closedAt = closedRes.error ? null : ((closedRes.data as { closed_at?: string | null } | null)?.closed_at ?? null);
  const rows = buildLedgerDraftsFromDeal({
    dealId: deal.id,
    dealType: deal.deal_type,
    closedDay: trDayOf(closedAt ?? deal.updated_at),
    amountTry: amount,
    buyer: buyer?.full_name ? { name: buyer.full_name, customerId: buyer.id } : null,
    seller: seller?.full_name ? { name: seller.full_name, customerId: seller.id } : null,
    propertyId: deal.property_id,
    method,
    buyerIdentityChecked: buyerChecked,
    sellerIdentityChecked: sellerChecked,
  });
  if (rows.length === 0) return { error: "Anlaşmada taraf bilgisi yok; kaydı elle ekleyin." };

  const thresholds = toThresholds(settingsRes.data as SettingsRow);
  const payload = rows.map((r) => {
    const retainUntil = computeRetainUntil(r.transactionDate, thresholds.retentionYears);
    return {
      tenant_id: gate.tenantId,
      kind: "entry",
      source: "auto",
      transaction_type: r.transactionType,
      transaction_date: r.transactionDate,
      party_name: r.partyName,
      party_role: r.partyRole,
      counterparty_name: r.counterpartyName,
      identity_checked: r.identityChecked,
      amount_try: r.amountTry,
      payment_method: r.method,
      flags: computeLedgerFlags({ amountTry: r.amountTry, method: r.method, identityChecked: r.identityChecked }, thresholds),
      threshold_snapshot: {
        cash_threshold_try: thresholds.cashThresholdTry,
        amount_threshold_try: thresholds.amountThresholdTry,
        retention_years: thresholds.retentionYears,
      },
      note: r.note,
      customer_id: r.customerId,
      property_id: r.propertyId,
      deal_id: r.dealId,
      retain_until: retainUntil,
      created_by: gate.userId,
    };
  });

  const { error } = await supabase.from("compliance_ledger_entries").insert(payload);
  if (error) {
    if (error.code === "23505") return { error: "Bu anlaşma zaten deftere işlenmiş." };
    if (error.code === "42703" || error.code === "PGRST204") return { error: "Kapanıştan deftere işleme bu ortamda henüz etkin değil; kaydı elle ekleyin." };
    console.error("recordDealInLedger", error.message);
    return { error: MISSING_TABLE.test(error.message) ? MISSING_MSG : actionErrorMessage(error, "Deftere işlenemedi.") };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "compliance_ledger.from_deal",
    entityType: "deal",
    entityId: deal.id,
    // Kişisel veri (taraf adı, tutar) denetim kaydına kopyalanmaz.
    newValue: { rows: rows.length, identity: { buyer: buyerChecked, seller: sellerChecked } },
  });
  revalidatePath("/app/uyum/kayit-defteri");
  revalidatePath("/app/uyum/denetim-dosyasi");
  const missingSeller = !seller?.full_name;
  return {
    ok: true,
    message: missingSeller
      ? `${rows.length} satır deftere işlendi. Portföyde ilan sahibi kaydı olmadığı için karşı taraf satırını elle ekleyin.`
      : `${rows.length} satır deftere işlendi.`,
  };
}
