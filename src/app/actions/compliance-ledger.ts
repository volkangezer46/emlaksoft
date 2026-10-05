"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { now, trDayKey } from "@/lib/clock";
import { toCsv } from "@/lib/export-entities";
import type { ExportResult } from "@/app/actions/export";
import {
  DEFAULT_LEDGER_THRESHOLDS,
  computeLedgerFlags,
  computeRetainUntil,
  mapLedgerCsvRow,
  parseLedgerForm,
  parseRetentionYears,
  parseThreshold,
  type LedgerCsvRow,
  type LedgerThresholds,
} from "@/lib/compliance/ledger";

export type LedgerActionResult = { ok?: boolean; error?: string; message?: string };

const MISSING_TABLE = /compliance_ledger|schema cache|does not exist/i;
const MISSING_MSG = "Yasal kayıt defteri bu ortamda henüz etkin değil.";
const EXPORT_LIMIT = 5000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    return { error: MISSING_TABLE.test(settingsError.message) ? MISSING_MSG : "Ayarlar okunamadı." };
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
    return { error: error && MISSING_TABLE.test(error.message) ? MISSING_MSG : "Kayıt eklenemedi." };
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
    return { error: MISSING_TABLE.test(error.message) ? MISSING_MSG : "Ayarlar kaydedilemedi." };
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

/** Defteri CSV olarak indirir (ofis sahibi / genel müdür); indirme denetim kaydına yazılır. */
export async function exportLedgerCsv(): Promise<ExportResult> {
  const gate = await requirePermission("compliance", "view");
  if (!gate.ok) return { error: gate.error };
  if (!isOfficeLevel(gate.role)) return { error: "Defteri yalnız ofis sahibi veya genel müdür indirebilir." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("compliance_ledger_entries")
    .select(
      "created_at, transaction_date, kind, transaction_type, party_name, party_role, counterparty_name, identity_checked, amount_try, payment_method, flags, retain_until, corrects_entry_id, note, created_by",
    )
    .eq("tenant_id", gate.tenantId)
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(EXPORT_LIMIT);
  if (error) {
    console.error("exportLedgerCsv", error.message);
    return { error: MISSING_TABLE.test(error.message) ? MISSING_MSG : "Dışa aktarma başarısız. Lütfen tekrar deneyin." };
  }

  const creatorIds = [...new Set((data ?? []).map((r) => r.created_by as string).filter((id) => UUID_RE.test(id)))];
  const names = new Map<string, string>();
  if (creatorIds.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("tenant_id", gate.tenantId)
      .in("id", creatorIds);
    for (const p of profiles ?? []) names.set(p.id, p.full_name);
  }
  const rows = (data ?? []).map((r) =>
    mapLedgerCsvRow({ ...(r as unknown as LedgerCsvRow), creator: names.get(r.created_by as string) ?? null }),
  );
  const truncated = rows.length >= EXPORT_LIMIT;
  let csv = toCsv(rows);
  if (truncated) csv += `\n"UYARI: Yalnızca ilk ${EXPORT_LIMIT} kayıt dışa aktarıldı."`;
  const filename = `kayit-defteri-${trDayKey()}.csv`;
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "export.csv",
    entityType: "compliance_ledger",
    newValue: { rows: rows.length, truncated, filename },
  });
  return { csv, filename, truncated, rowCount: rows.length, entity: "compliance_ledger" };
}
