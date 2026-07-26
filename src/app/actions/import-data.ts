"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { isValidTurkishMobile, normalizeTurkishPhone } from "@/lib/phone";

/**
 * CSV içe aktarma (X — /app/ice-aktarma sihirbazı, adım 3).
 *
 * Tasarım notları:
 *  - Satırlar client'ta kolon eşlemesinden geçmiş halde gelir (alan adı →
 *    değer); dosya/parse işi tamamen client'ta, burada yalnızca doğrulama +
 *    yazma var. 1000 satır üst sınırı hem client hem burada uygulanır.
 *  - MÜKERRER KORUMASI (yalnız müşteri): normalize telefon tenant'ta zaten
 *    kayıtlıysa satır eklenmez, "atlandı (mevcut)" olarak raporlanır. Dosya
 *    içi tekrar eden telefonlar da ilkinden sonrası için atlanır.
 *  - Insert'ler 100'lük parçalarda yapılır; bir parça patlarsa yalnız o
 *    parçadaki satırlar "hatalı" sayılır, kalanlar denenmeye devam eder.
 *  - logActivity TEK toplu kayıt yazar (bkz. customer.bulk_assign deseni).
 */

// "use server" dosyası yalnız async fonksiyon export edebilir — satır sınırı
// client ile paylaşılan sabit olarak ice-aktarma/import-config.ts'te yaşar.
const IMPORT_ROW_LIMIT = 1000;
const CHUNK_SIZE = 100;

export type ImportRowError = { row: number; reason: string };

export type ImportSummary = {
  ok?: boolean;
  error?: string;
  inserted?: number;
  skipped?: number;
  errors?: ImportRowError[];
};

export type CustomerImportRow = {
  /** Dosyadaki satır numarası (başlık hariç, 1'den başlar) — hata raporu için. */
  row: number;
  full_name?: string;
  phone?: string;
  email?: string;
  customer_type?: string;
  source?: string;
  notes?: string;
};

export type PropertyImportRow = {
  row: number;
  title?: string;
  transaction_type?: string;
  property_type?: string;
  list_price?: string;
  rooms?: string;
  sqm?: string;
  address_line?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const clean = (v: string | undefined | null) => String(v ?? "").trim();

/** "1.250.000,50" / "1250000.50" / "1 250 000 TL" → sayı; geçersizse null. */
function parseTurkishNumber(raw: string): number | null {
  const s = clean(raw).replace(/[^\d.,]/g, "");
  if (!s) return null;
  let normalized = s;
  if (s.includes(",")) {
    // Virgül ondalık, noktalar binlik kabul edilir (TR yazımı).
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else {
    const dots = (s.match(/\./g) ?? []).length;
    // Birden çok nokta ya da 1.250 gibi binlik kalıbı → noktalar binlik.
    if (dots > 1 || /^\d{1,3}(\.\d{3})+$/.test(s)) normalized = s.replace(/\./g, "");
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function limitCheck<T>(rows: T[]): string | null {
  if (!Array.isArray(rows) || rows.length === 0) return "İçe aktarılacak satır bulunamadı.";
  if (rows.length > IMPORT_ROW_LIMIT) {
    return `Tek seferde en fazla ${IMPORT_ROW_LIMIT} satır içe aktarılabilir. Dosyayı bölerek tekrar deneyin.`;
  }
  return null;
}

export async function importCustomers(rows: CustomerImportRow[]): Promise<ImportSummary> {
  const gate = await requirePermission("customers", "create");
  if (!gate.ok) return { error: gate.error };
  const limitError = limitCheck(rows);
  if (limitError) return { error: limitError };

  const supabase = await createClient();
  const errors: ImportRowError[] = [];
  let skipped = 0;

  // 1) Satır bazlı doğrulama + normalize
  type ValidRow = { row: number; insert: Record<string, unknown>; phone: string };
  const valid: ValidRow[] = [];
  for (const r of rows) {
    const fullName = clean(r.full_name);
    const phoneRaw = clean(r.phone);
    const email = clean(r.email);
    if (!fullName) {
      errors.push({ row: r.row, reason: "Ad soyad boş." });
      continue;
    }
    if (phoneRaw && !isValidTurkishMobile(phoneRaw)) {
      errors.push({ row: r.row, reason: `Telefon geçersiz: "${phoneRaw}" (05XX XXX XX XX bekleniyor).` });
      continue;
    }
    if (email && !EMAIL_RE.test(email)) {
      errors.push({ row: r.row, reason: `E-posta biçimi geçersiz: "${email}".` });
      continue;
    }
    const phone = phoneRaw ? normalizeTurkishPhone(phoneRaw) : "";
    const type = clean(r.customer_type);
    valid.push({
      row: r.row,
      phone,
      insert: {
        tenant_id: gate.tenantId,
        full_name: fullName,
        phone: phone || null,
        email: email || null,
        customer_types: type ? [type] : [],
        source: clean(r.source) || "İçe aktarma",
        notes: clean(r.notes) || null,
        assigned_to: gate.userId,
        created_by: gate.userId,
      },
    });
  }

  // 2) Mükerrer koruması — tenant'taki mevcut normalize telefonlar
  const phones = [...new Set(valid.map((v) => v.phone).filter(Boolean))];
  const existing = new Set<string>();
  for (let i = 0; i < phones.length; i += 200) {
    const { data, error } = await supabase
      .from("customers")
      .select("phone")
      .eq("tenant_id", gate.tenantId)
      .is("deleted_at", null)
      .in("phone", phones.slice(i, i + 200));
    if (error) {
      console.error("importCustomers duplicate check", error);
      return { error: "Mükerrer kontrolü yapılamadı. Lütfen tekrar deneyin." };
    }
    for (const d of data ?? []) if (d.phone) existing.add(String(d.phone));
  }

  const seenInFile = new Set<string>();
  const toInsert: ValidRow[] = [];
  for (const v of valid) {
    if (v.phone && existing.has(v.phone)) {
      skipped += 1;
      errors.push({ row: v.row, reason: "Atlandı (mevcut): bu telefon zaten kayıtlı." });
      continue;
    }
    if (v.phone && seenInFile.has(v.phone)) {
      skipped += 1;
      errors.push({ row: v.row, reason: "Atlandı (mevcut): aynı telefon dosyada daha önce geçiyor." });
      continue;
    }
    if (v.phone) seenInFile.add(v.phone);
    toInsert.push(v);
  }

  // 3) 100'lük parçalarla insert — patlayan parça yalnız kendi satırlarını düşürür
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
    const chunk = toInsert.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase.from("customers").insert(chunk.map((c) => c.insert));
    if (error) {
      console.error("importCustomers insert chunk", error);
      for (const c of chunk) errors.push({ row: c.row, reason: "Veritabanına yazılamadı." });
    } else {
      inserted += chunk.length;
    }
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "customer.import",
    entityType: "customer",
    newValue: {
      total: rows.length,
      inserted,
      skipped,
      failed: rows.length - inserted - skipped,
    },
  });

  revalidatePath("/app/musteriler");
  errors.sort((a, b) => a.row - b.row);
  return { ok: true, inserted, skipped, errors };
}

export async function importProperties(rows: PropertyImportRow[]): Promise<ImportSummary> {
  const gate = await requirePermission("properties", "create");
  if (!gate.ok) return { error: gate.error };
  const limitError = limitCheck(rows);
  if (limitError) return { error: limitError };

  const supabase = await createClient();
  const errors: ImportRowError[] = [];

  // properties.transaction_type/property_type NOT NULL — eşlenmemiş/boş
  // değerlerde en yaygın varsayılanlar kullanılır (tanımlar ekranından
  // sonradan düzeltilebilir serbest metin alanları).
  const stamp = new Date().toISOString().slice(2, 7).replace("-", "");
  type ValidRow = { row: number; insert: Record<string, unknown> };
  const toInsert: ValidRow[] = [];
  for (const r of rows) {
    const title = clean(r.title);
    if (!title) {
      errors.push({ row: r.row, reason: "Başlık boş." });
      continue;
    }
    const priceRaw = clean(r.list_price);
    let listPrice: number | null = null;
    if (priceRaw) {
      listPrice = parseTurkishNumber(priceRaw);
      if (listPrice === null || listPrice <= 0) {
        errors.push({ row: r.row, reason: `Fiyat sayı değil: "${priceRaw}".` });
        continue;
      }
    }
    const sqmRaw = clean(r.sqm);
    const sqm = sqmRaw ? parseTurkishNumber(sqmRaw) : null;
    const suffix = crypto.randomUUID().slice(0, 6).toUpperCase();
    toInsert.push({
      row: r.row,
      insert: {
        tenant_id: gate.tenantId,
        property_code: `ES-${stamp}-${suffix}`,
        title,
        transaction_type: clean(r.transaction_type) || "Satılık",
        property_type: clean(r.property_type) || "Diğer",
        status: "draft",
        list_price: listPrice,
        address_line: clean(r.address_line) || null,
        features: {
          rooms: clean(r.rooms) || null,
          sqm: sqm !== null && Number.isFinite(sqm) ? sqm : null,
        },
        assigned_to: gate.userId,
        created_by: gate.userId,
      },
    });
  }

  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
    const chunk = toInsert.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase.from("properties").insert(chunk.map((c) => c.insert));
    if (error) {
      console.error("importProperties insert chunk", error);
      for (const c of chunk) errors.push({ row: c.row, reason: "Veritabanına yazılamadı." });
    } else {
      inserted += chunk.length;
    }
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.import",
    entityType: "property",
    newValue: { total: rows.length, inserted, failed: rows.length - inserted },
  });

  revalidatePath("/app/portfoyler");
  errors.sort((a, b) => a.row - b.row);
  return { ok: true, inserted, skipped: 0, errors };
}
