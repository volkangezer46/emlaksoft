import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Üretim hata kaydı.
 *
 * NEDEN `lib/` — `actions/` DEĞİL: `"use server"` dosyasından export edilen
 * her fonksiyon tarayıcıdan çağrılabilen bir uç nokta olur. Bu modül
 * `service_role` kullanıyor; uç nokta hâline gelirse herkes istediği kiracıya
 * hata satırı yazdırabilirdi. (Aynı hata `notifyTenant`ta bulunmuştu.)
 *
 * İstemciden çağrı için `app/actions/report-error.ts` içinde ince bir sarmalayıcı
 * var; o sarmalayıcı kiracı kimliğini ÇAĞIRANDAN DEĞİL oturumdan alıyor.
 *
 * NEDEN `service_role`: Hata, kullanıcının oturumu bozulduğu için de olabilir.
 * Kiracısı bilinmeyen bir hatayı kullanıcının kendi istemcisiyle yazmak RLS
 * yüzünden mümkün değil — ve tam da o hatalar en çok merak edilenler.
 */

/** Tabloya yazılan metinlerin üst sınırı. Uzun yığın izleri satırı şişirir. */
const MAX_MESSAGE = 500;
const MAX_STACK = 4000;

/** Süreç ömrü boyunca tek uyarı; aşağıdaki catch bloğunda gerekçesi var. */
let uyarildi = false;

/**
 * Parmak izi için mesajı normalleştirir.
 *
 * Aynı hata her seferinde farklı bir id/sayı taşıyabilir:
 *   "Customer 8f3a... not found"  ·  "Customer b21c... not found"
 * Bunlar TEK bir hata; maskelenmezse tablo aynı sorunun binlerce kopyasıyla
 * dolar ve "kaç farklı hata var" sorusu cevapsız kalır.
 */
function normalize(message: string): string {
  return message
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>")
    .replace(/\b\d{4,}\b/g, "<num>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/**
 * Kısa, kararlı bir özet. Kriptografik olması gerekmiyor — yalnızca aynı
 * girdinin aynı çıktıyı vermesi yeterli (djb2).
 */
function fingerprint(parts: (string | null | undefined)[]): string {
  const s = parts.filter(Boolean).join("|");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export type ErrorLogInput = {
  message: string;
  source?: "client" | "server";
  digest?: string | null;
  stack?: string | null;
  path?: string | null;
  userAgent?: string | null;
  tenantId?: string | null;
  userId?: string | null;
};

/**
 * Hatayı kaydeder. ASLA hata fırlatmaz — kayıt yolunda bir sorun çıkarsa
 * asıl hatanın üstünü örtmemeli.
 */
export async function logError(input: ErrorLogInput): Promise<void> {
  try {
    const message = (input.message ?? "").slice(0, MAX_MESSAGE);
    if (!message.trim()) return;

    const source = input.source ?? "client";
    const path = input.path ?? null;
    const fp = fingerprint([input.tenantId ?? "-", source, normalize(message), path]);

    const admin = createAdminClient();

    /*
     * Önce artırmayı dene. Satır yoksa 0 kayıt güncellenir ve insert'e düşeriz.
     * Bunu tek bir upsert ile yapamıyoruz çünkü `occurrences` ARTMALI, üzerine
     * yazılmamalı — upsert eski değeri okuyamaz.
     */
    const { data: mevcut } = await admin
      .from("error_logs")
      .select("id, occurrences")
      .eq("fingerprint", fp)
      .is("resolved_at", null)
      .limit(1)
      .maybeSingle();

    if (mevcut) {
      await admin
        .from("error_logs")
        .update({ occurrences: (mevcut.occurrences ?? 1) + 1, last_seen: new Date().toISOString() })
        .eq("id", mevcut.id);
      return;
    }

    // supabase-js hata FIRLATMAZ, `{ error }` döndürür — catch bloğu bunu
    // görmez. GRANT eksikliği tam olarak bu yoldan sessizce geçmişti.
    const { error: yazmaHatasi } = await admin.from("error_logs").insert({
      tenant_id: input.tenantId ?? null,
      user_id: input.userId ?? null,
      source,
      digest: input.digest ?? null,
      message,
      stack: input.stack ? input.stack.slice(0, MAX_STACK) : null,
      path,
      user_agent: input.userAgent ? input.userAgent.slice(0, 300) : null,
      fingerprint: fp,
    });
    if (yazmaHatasi && !uyarildi) {
      uyarildi = true;
      console.warn("[error-log] hata kaydı yazılamıyor:", yazmaHatasi.message);
    }
  } catch (e) {
    /*
     * Kayıt yolu asıl akışı ASLA bozmamalı — bu yüzden hata yutuluyor.
     *
     * Ama TAMAMEN sessiz olamaz: ilk sürümde tam da bu oldu. Tabloya
     * `service_role` GRANT'i verilmemişti, her yazma 42501 ile düşüyordu ve
     * özellik hiç çalışmıyordu — hiçbir yerde tek bir iz yoktu. Bunu ancak
     * elle bir insert denerken buldum.
     *
     * Uzlaşma: en fazla bir kez uyar. Bir hata döngüsünde log gürültüsünü
     * katlamaz, ama kalıcı bir yapılandırma hatası görünmez kalmaz.
     */
    if (!uyarildi) {
      uyarildi = true;
      console.warn("[error-log] hata kaydı yazılamıyor:", (e as Error)?.message ?? e);
    }
  }
}
