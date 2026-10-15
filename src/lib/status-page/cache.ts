import "server-only";
import { revalidateTag, unstable_cache } from "next/cache";
import { now } from "@/lib/clock";
import { loadPublicStatus, type PublicStatus } from "./read";

/**
 * /durum veri önbelleği (B017). Sayfa DİNAMİK çizilir (ISR yok: `s-maxage=60, stale-while-revalidate=1 yıl` boşluktan
 * sonraki ilk ziyaretçiye 52 dk bayat sayfa veriyordu). Veri 30 sn paylaşılan önbellekte (olay anında DB'yi ziyaretçi
 * seli korunur); ama önbellek SWR olduğundan uzun boşluktan sonra bayat değer dönebilir: okunan değer `STATUS_MAX_AGE_MS`
 * (60 sn) üstündeyse doğrudan okunur. Sonuç: ilk ziyaretçi dahil içerik en çok 60 sn yaşında ("dakikada bir yenilenir").
 * Adminden olay/bakım değişince `bustStatusPage()` etiketi anında düşürür.
 */
export const STATUS_PAGE_TAG = "status-page";
export const STATUS_MAX_AGE_MS = 60_000;

type Snapshot = { at: number; status: PublicStatus };

const cached = unstable_cache(
  async (): Promise<Snapshot> => {
    const at = now();
    return { at, status: await loadPublicStatus(at) };
  },
  ["durum-public-status-v1"],
  { revalidate: 30, tags: [STATUS_PAGE_TAG] },
);

/** Bayatlık sınırı (saf): önbellekten gelen anlık görüntü kullanılabilir mi? */
export function isFreshSnapshot(atMs: number, nowMs: number, maxAgeMs = STATUS_MAX_AGE_MS): boolean {
  return nowMs - atMs <= maxAgeMs && atMs <= nowMs + 5_000;
}

/** En çok 60 sn yaşında durum (önbellek bayatsa doğrudan okur). */
export async function readPublicStatusFresh(): Promise<Snapshot> {
  const nowMs = now();
  try {
    const hit = await cached();
    if (isFreshSnapshot(hit.at, nowMs)) return hit;
  } catch (e) {
    console.error("durum cache", e instanceof Error ? e.message : e);
  }
  return { at: nowMs, status: await loadPublicStatus(nowMs) };
}

/** Olay/bakım yazımından sonra: veri önbelleği anında düşer (rota ve eylem bağlamında güvenli). */
export function bustStatusPage(): void {
  try {
    revalidateTag(STATUS_PAGE_TAG, { expire: 0 });
  } catch {
    /* istek bağlamı dışı: en geç 60 sn'de tazelenir */
  }
}
