import type { SupabaseClient } from "@supabase/supabase-js";
import { now } from "@/lib/clock";

/**
 * Çevrimdışı kuyruk / yeniden deneme için ÇİFT KAYIT FRENİ (sunucu tarafı).
 *
 * İstemci her hızlı kayıt formuna bir istek kimliği (`client_request_id`, UUID) koyar; kuyruk aynı isteği kaç kez
 * gönderirse göndersin kimlik aynıdır. Akış:
 *   1) (kiracı, kullanıcı, istek) satırı `client_submissions`'a EKLENİR (birincil anahtar = talep). Ekleme başarılıysa
 *      kayıt bu çağrıda açılır.
 *   2) Kayıt açılınca satıra `completed_at` + `result_id` yazılır. Aynı istek tekrar gelirse yeni kayıt AÇILMAZ, ilk
 *      kaydın kimliği döner (yanıtı kaybolan istek bağlantı gelince bir kez kaydedilmiş olur).
 *   3) Kayıt doğrulama/iş kuralıyla reddedilirse satır silinir: kullanıcı formu düzeltip aynı kimlikle gönderebilir.
 *   4) Satır var ama tamamlanmamışsa (eşzamanlı ikinci sekme ya da yarıda kalan istek): 2 dakikadan yeniyse "gönderiliyor"
 *      döner (kuyruk sonra yeniden dener), daha eskiyse önceki deneme ölü sayılır ve talep devralınır.
 * Tablo yoksa (migration öncesi) ya da beklenmeyen DB hatasında fren ATLANIR (fail-open): kayıt kaybolmaz; yinelenen kayıt
 * riski yalnız o istisnai durumda kalır ve mevcut mükerrer frenleri (müşteri telefonu, portföy) yine çalışır.
 * 30 günden eski satırlar kullanıcının kendi satırlarından budanır (RLS: yalnız kendi satırı).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const STALE_CLAIM_MS = 2 * 60_000;
const RETENTION_MS = 30 * 86_400_000;

export type SubmissionKind = "customer" | "call" | "appointment" | "property";
export type SubmissionKey = { tenantId: string; userId: string; requestId: string };
type DbError = { code?: string | null; message?: string | null } | null;
type ClaimRow = { result_id: string | null; completed_at: string | null; created_at: string };

/** Fren deposu (birim testte bellek içi sahte verilir). */
export type SubmissionStore = {
  claim(key: SubmissionKey, kind: SubmissionKind): Promise<{ error: DbError }>;
  read(key: SubmissionKey): Promise<ClaimRow | null>;
  touch(key: SubmissionKey, atIso: string): Promise<void>;
  complete(key: SubmissionKey, resultId: string | null, atIso: string): Promise<void>;
  release(key: SubmissionKey): Promise<void>;
  prune(tenantId: string, userId: string, beforeIso: string): Promise<void>;
};

export type GuardedResult = { ok?: boolean; id?: string; error?: string };

export function isMissingSubmissionTable(error: DbError): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (code === "42P01" || code === "PGRST205") return true;
  const msg = error.message ?? "";
  return /client_submissions/i.test(msg) && /does not exist|schema cache|could not find/i.test(msg);
}

export function readRequestId(formData: FormData): string | null {
  const raw = String(formData.get("client_request_id") ?? "").trim();
  return UUID_RE.test(raw) ? raw.toLowerCase() : null;
}

/** Oturumlu Supabase istemcisiyle depo (RLS: yalnız kendi kiracı + kullanıcı satırı). */
export function supabaseSubmissionStore(supabase: SupabaseClient): SubmissionStore {
  const t = () => supabase.from("client_submissions");
  return {
    async claim(k, kind) {
      const { error } = await t().insert({ tenant_id: k.tenantId, user_id: k.userId, request_id: k.requestId, kind });
      return { error };
    },
    async read(k) {
      const { data } = await t()
        .select("result_id, completed_at, created_at")
        .eq("tenant_id", k.tenantId)
        .eq("user_id", k.userId)
        .eq("request_id", k.requestId)
        .maybeSingle();
      return (data as ClaimRow | null) ?? null;
    },
    async touch(k, atIso) {
      await t()
        .update({ created_at: atIso })
        .eq("tenant_id", k.tenantId)
        .eq("user_id", k.userId)
        .eq("request_id", k.requestId)
        .is("completed_at", null);
    },
    async complete(k, resultId, atIso) {
      await t()
        .update({ completed_at: atIso, result_id: resultId })
        .eq("tenant_id", k.tenantId)
        .eq("user_id", k.userId)
        .eq("request_id", k.requestId);
    },
    async release(k) {
      await t()
        .delete()
        .eq("tenant_id", k.tenantId)
        .eq("user_id", k.userId)
        .eq("request_id", k.requestId)
        .is("completed_at", null);
    },
    async prune(tenantId, userId, beforeIso) {
      await t().delete().eq("tenant_id", tenantId).eq("user_id", userId).lt("created_at", beforeIso);
    },
  };
}

/**
 * `run` yalnız bu istek kimliğiyle daha önce kayıt AÇILMADIYSA çalışır. Kimlik yoksa (eski istemci) doğrudan çalışır.
 */
export async function onceByRequest<T extends GuardedResult>(
  store: SubmissionStore,
  ctx: { tenantId: string; userId: string },
  kind: SubmissionKind,
  requestId: string | null,
  run: () => Promise<T>,
): Promise<T | GuardedResult> {
  if (!requestId) return run();
  const key: SubmissionKey = { ...ctx, requestId };
  const iso = (ms: number) => new Date(ms).toISOString();

  const claim = await store.claim(key, kind);
  if (claim.error) {
    if (isMissingSubmissionTable(claim.error)) return run();
    if (claim.error.code !== "23505") {
      console.error("client_submissions claim", { code: claim.error.code ?? null });
      return run();
    }
    const prev = await store.read(key);
    if (prev?.completed_at) return { ok: true, ...(prev.result_id ? { id: prev.result_id } : {}) };
    const startedMs = prev?.created_at ? Date.parse(prev.created_at) : 0;
    if (prev && now() - startedMs < STALE_CLAIM_MS) {
      return { error: "Bu kayıt az önce gönderildi; sonuç bekleniyor. Birazdan otomatik yeniden denenecek." };
    }
    // Yarıda kalmış eski talep: devral.
    if (prev) await store.touch(key, iso(now()));
  }

  let res: T;
  try {
    res = await run();
  } catch (e) {
    await store.release(key).catch(() => undefined);
    throw e;
  }
  try {
    if (res.ok) await store.complete(key, res.id && UUID_RE.test(res.id) ? res.id : null, iso(now()));
    else await store.release(key);
    await store.prune(ctx.tenantId, ctx.userId, iso(now() - RETENTION_MS));
  } catch (e) {
    // Fren kaydı yazılamadı: kayıt yine de açıldı/açılmadı; sonucu bozmayız.
    console.error("client_submissions finalize", e instanceof Error ? e.message : "bilinmeyen hata");
  }
  return res;
}
