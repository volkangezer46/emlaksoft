import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { actionErrorMessage } from "@/lib/action-errors";
import { revalidateTenantData } from "@/lib/revalidate";
import { financeOutcomeMessage, isUuid } from "@/lib/finance/cash/input";
import { isMissingCashSchema } from "@/lib/finance/cash/load";
import { MAX_STATEMENT_BYTES, parseStatementFile, toStagePayload } from "./file";
import { loadSavedMapping } from "./load";
import { applyColumnMapping, guessColumnMapping, isCompleteMapping, mappingFits, type ColumnMapping } from "./parse";

/**
 * Ekstre dosyası yükleme servisi (SUNUCU). `/api/app/finans/ekstre` ucu çağırır; ikili gövde server action yerine route handler'dadır
 * (server action gövde sınırı 4 MB ve yalnız logo/foto eylemlerine ayrılmıştır). Yetki: OFİS hesabı `expenses:create`, KİŞİSEL hesap
 * `dashboard:view` (asıl kural RPC + RLS). Ham dosya, dosya adı ve satır içeriği loglanmaz/saklanmaz; service_role YOK.
 */

const MISSING_MSG = "Ekstre yükleme için veritabanı güncellemesi henüz uygulanmamış.";
const PATHS = ["/app/giderler", "/app/hesabim"] as const;

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

async function accountScope(accountId: string): Promise<"office" | "user" | null> {
  if (!isUuid(accountId)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("finance_accounts").select("owner_scope").eq("id", accountId).maybeSingle();
  const scope = (data as { owner_scope?: string } | null)?.owner_scope;
  return scope === "office" || scope === "user" ? scope : null;
}

function rpcFailure(error: { code?: string | null; message?: string | null } | null, fallback: string): { error: string } {
  if (isMissingCashSchema(error)) return { error: MISSING_MSG };
  console.error("finance-statement", { code: error?.code });
  return { error: actionErrorMessage(error, fallback) };
}

export type StatementPreview =
  | {
      ok: true;
      format: "csv" | "xlsx";
      headers: string[];
      preview: string[][];
      totalRows: number;
      mapping: Partial<ColumnMapping>;
      mappingSource: "saved" | "guessed";
    }
  | {
      ok: true;
      format: "ofx";
      lineCount: number;
      invalid: number;
      preview: { date: string; dir: "in" | "out"; amount: number; description: string }[];
    }
  | { ok?: false; error: string };

export type StageResult = { ok?: boolean; error?: string; importId?: string; inserted?: number; duplicates?: number; invalid?: number; truncated?: boolean };


function checkFile(f: unknown): File | { error: string } {
  if (!(f instanceof File) || f.size === 0) return { error: "Önce ekstre dosyasını seçin." };
  if (f.size > MAX_STATEMENT_BYTES) return { error: "Dosya en çok 2 MB olabilir. Ekstreyi daha kısa bir tarih aralığıyla indirip tekrar deneyin." };
  return f;
}

function parseMappingField(raw: unknown): Partial<ColumnMapping> | null {
  if (typeof raw !== "string" || raw.length > 500) return null;
  try {
    const o = asObject(JSON.parse(raw));
    const out: Partial<ColumnMapping> = {};
    for (const key of ["date", "description", "amount", "debit", "credit", "balance"] as const) {
      const v = o[key];
      if (v === undefined || v === null || v === "") continue;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 99) return null;
      out[key] = v;
    }
    return out;
  } catch {
    return null;
  }
}

/** Adım 1: dosyayı okur; ilk 5 satır önizlemesi + (hatırlanan ya da tahmin edilen) sütun eşlemesi. Hiçbir şey kaydedilmez. */
export async function previewStatement(accountId: string, formData: FormData): Promise<StatementPreview> {
  const scope = await accountScope(accountId);
  if (!scope) return { error: "Hesap bulunamadı." };
  const gate = scope === "user" ? await requirePermission("dashboard", "view") : await requirePermission("expenses", "create");
  if (!gate.ok) return { error: gate.error };
  const file = checkFile(formData.get("file"));
  if (!(file instanceof File)) return file;

  const parsed = await parseStatementFile(file.name, new Uint8Array(await file.arrayBuffer()));
  if (!parsed.ok) return { error: parsed.error };
  if (parsed.format === "ofx") {
    const { lines, invalid } = parsed.statement;
    if (lines.length === 0) return { error: "OFX dosyasında okunabilir hareket bulunamadı." };
    return { ok: true, format: "ofx", lineCount: lines.length, invalid, preview: lines.slice(0, 5).map((l) => ({ date: l.date, dir: l.dir, amount: l.amount, description: l.description })) };
  }
  const { headers, rows } = parsed.table;
  if (headers.length < 2 || rows.length === 0) return { error: "Dosyada tablo bulunamadı. Bankanın ekstre (hesap hareketleri) dosyasını yükleyin." };
  const supabase = await createClient();
  const saved = await loadSavedMapping(supabase, accountId);
  const useSaved = isCompleteMapping(saved) && mappingFits(saved, headers.length);
  return {
    ok: true,
    format: parsed.format,
    headers,
    preview: rows.slice(0, 5),
    totalRows: rows.length,
    mapping: useSaved ? saved : guessColumnMapping(headers),
    mappingSource: useSaved ? "saved" : "guessed",
  };
}

/** Adım 2: dosyayı eşlemeyle ayrıştırır ve satırları "içe aktarma taslağı" olarak yazar (mükerrer dosya/satır engelli). */
export async function stageStatement(accountId: string, formData: FormData): Promise<StageResult> {
  const scope = await accountScope(accountId);
  if (!scope) return { error: "Hesap bulunamadı." };
  const gate = scope === "user" ? await requirePermission("dashboard", "view") : await requirePermission("expenses", "create");
  if (!gate.ok) return { error: gate.error };
  const file = checkFile(formData.get("file"));
  if (!(file instanceof File)) return file;

  const parsed = await parseStatementFile(file.name, new Uint8Array(await file.arrayBuffer()));
  if (!parsed.ok) return { error: parsed.error };

  let mapped;
  let mappingToSave: ColumnMapping | null = null;
  if (parsed.format === "ofx") {
    mapped = parsed.statement;
  } else {
    const m = parseMappingField(formData.get("mapping"));
    if (!isCompleteMapping(m) || !mappingFits(m, parsed.table.headers.length)) {
      return { error: "Sütun eşlemesi eksik: tarih, açıklama ve tutar (ya da borç ve alacak) sütunlarını seçin." };
    }
    mapped = applyColumnMapping(parsed.table, m);
    mappingToSave = m;
  }
  if (mapped.lines.length === 0) {
    return { error: "Seçtiğiniz eşlemeyle okunabilir hareket bulunamadı. Tarih ve tutar sütunlarını kontrol edin." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_statement_stage", {
    p_account_id: accountId,
    p_file_hash: parsed.fileHash,
    p_format: parsed.format,
    p_lines: toStagePayload(mapped.lines),
  });
  if (error) return rpcFailure(error, "Ekstre yüklenemedi.");
  const res = asObject(data);
  const outcome = String(res.outcome ?? "");
  if (outcome === "duplicate_file") return { error: "Bu ekstre dosyası bu hesaba daha önce yüklenmiş. Aynı dosya ikinci kez alınmaz." };
  if (outcome === "nothing_new") return { error: "Dosyadaki tüm satırlar daha önce yüklenmiş; yeni hareket yok." };
  if (outcome === "no_valid_rows") return { error: "Geçerli satır yok. Tarihler hesabın açılış tarihinden önce ya da bugünden sonra olabilir." };
  if (outcome !== "staged") return { error: financeOutcomeMessage(outcome) };

  if (mappingToSave) {
    const saveRes = await supabase.rpc("finance_statement_mapping_save", { p_account_id: accountId, p_mapping: mappingToSave });
    if (saveRes.error && !isMissingCashSchema(saveRes.error)) console.error("finance-statement mapping", { code: saveRes.error.code });
  }
  revalidateTenantData(gate.tenantId, PATHS);
  return {
    ok: true,
    importId: String(res.import_id ?? ""),
    inserted: Number(res.inserted ?? 0),
    duplicates: Number(res.duplicates ?? 0),
    invalid: Number(res.invalid ?? 0) + mapped.invalid,
    truncated: mapped.truncated,
  };
}

