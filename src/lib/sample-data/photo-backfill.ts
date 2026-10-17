import type { SupabaseClient } from "@supabase/supabase-js";
import { assignDemoPhotos } from "@/lib/sample-data/demo-photo-pick";

/**
 * Fotoğrafsız demo ilanlarına kütüphane seti bağlar (son adım). Çekirdek paket ilanları kendi setini alır; modül tohumları
 * (mülk yönetimi, kiralık dükkân, arsa …) ve eski demo ilanları fotoğrafsız kalıyordu — demo ofiste boş kapak satış
 * değerini düşürür. Yalnız HİÇ medyası olmayan ilanlara dokunur (demo taslağı da kapaklı görünür) (elle yüklenmiş görsel korunur); satırlar
 * statik `/img/demo` yoluna işaret eder (depo nesnesi yok, temizlik dosyaya dokunmaz).
 */
export async function attachLibraryPhotosToBareListings(
  db: SupabaseClient,
  tenantId: string,
  uploadedBy: string | null,
  opts: { sampleOnly: boolean; districtNames: (ids: string[]) => Promise<Map<string, string>> },
): Promise<number> {
  // Gömme yok (iki FK'lı tablolarda ipucusuz gömme sessizce boş döner): ilan ve medya ayrı sorgu.
  let q = db
    .from("properties")
    .select("id, property_type, transaction_type, title, district_id")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .limit(500);
  if (opts.sampleOnly) q = q.eq("is_sample", true);
  const { data, error } = await q;
  if (error) throw error;
  type Row = { id: string; property_type: string | null; transaction_type: string | null; title: string | null; district_id: string | null };
  const all = (data ?? []) as Row[];
  if (all.length === 0) return 0;
  const { data: media, error: mErr } = await db.from("property_media").select("property_id").eq("tenant_id", tenantId).in("property_id", all.map((r) => r.id));
  if (mErr) throw mErr;
  const withMedia = new Set(((media ?? []) as { property_id: string }[]).map((m) => m.property_id));
  const bare = all.filter((r) => !withMedia.has(r.id));
  if (bare.length === 0) return 0;
  const districtIds = [...new Set(bare.flatMap((r) => (r.district_id ? [r.district_id] : [])))];
  // İlçe adı çağırandan gelir (coğrafya tek merkez: uygulamada geo/reader, betikte kendi geo önbelleği).
  // İlçe yalnız set seçim puanını iyileştirir: okunamazsa (ör. CLI'da Next önbelleği yok) türe göre seçim sürer.
  const districtName = districtIds.length ? await opts.districtNames(districtIds).catch(() => new Map<string, string>()) : new Map<string, string>();
  const picks = assignDemoPhotos(
    bare.map((r) => ({
      code: r.id,
      type: r.property_type ?? "Daire",
      tx: r.transaction_type ?? undefined,
      rooms: (r.title ?? "").match(/\b(\d\+\d)\b/)?.[1] ?? null,
      districtName: (r.district_id && districtName.get(r.district_id)) || "",
    })),
  );
  const rows = bare.flatMap((r) => (picks.get(r.id) ?? []).map((m) => ({ tenant_id: tenantId, property_id: r.id, storage_path: null, uploaded_by: uploadedBy, ...m })));
  if (rows.length === 0) return 0;
  const { error: insErr } = await db.from("property_media").insert(rows);
  if (insErr) throw insErr;
  return rows.length;
}
