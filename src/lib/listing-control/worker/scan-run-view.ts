import type { ScanStatusView } from "./extension-status-view";

/**
 * "ŞİMDİ TARA" CANLI GÖRÜNÜMÜ (SAF, testli). Eklenti durum görünümünden (`ScanStatusView`) ilerleme metni ve koşu sonucu
 * türetir. Saat kullanılmaz: koşunun başlangıcı, istek anındaki en yeni `lastTryAt` (eklenti saati) ile işaretlenir.
 * DÜRÜSTLÜK: okunamayan/engellenen portal asla "ilan yok" diye gösterilmez; "kontrol edilemedi" denir.
 */

export function scanBaseline(scan: ScanStatusView | undefined | null): number {
  return Math.max(0, ...(scan?.portals ?? []).map((p) => p.lastTryAt ?? 0));
}

/** "İlanların okunuyor… 3/5 sayfa" (toplam sayfa tahmini ilan sayısından; bilinmiyorsa yalnız okunan sayfa). */
export function scanProgressText(scan: ScanStatusView | undefined | null): string {
  const pages = scan?.activePages ?? 0;
  const read = scan?.activeRead ?? 0;
  const expected = scan?.activeExpected ?? null;
  if (pages <= 0) return "İlanların okunuyor…";
  if (expected && expected > 0 && read > 0) {
    const perPage = read / pages;
    const total = Math.max(pages, Math.ceil(expected / Math.max(1, perPage)));
    return `İlanların okunuyor… ${pages}/${total} sayfa`;
  }
  return `İlanların okunuyor… ${pages}. sayfa`;
}

export type ScanRunPortal = { id: string; result: "complete" | "partial" | "unreadable" | "blocked"; read: number; expected: number | null };

export type ScanRunState =
  | { phase: "running" }
  | { phase: "uploading" }
  | { phase: "done"; portals: ScanRunPortal[] }
  | { phase: "idle" };

/** Koşu durumu: taranıyor → sonuç yükleniyor → bitti (başlangıçtan sonra denenen portallar). */
export function scanRunState(scan: ScanStatusView | undefined | null, baseline: number): ScanRunState {
  if (!scan) return { phase: "idle" };
  if (scan.active) return { phase: "running" };
  const tried = scan.portals.filter((p) => (p.lastTryAt ?? 0) > baseline && p.lastResult !== null);
  if (tried.length === 0) return { phase: "idle" };
  if (scan.pendingUploads > 0) return { phase: "uploading" };
  return {
    phase: "done",
    portals: tried.map((p) => ({ id: p.id, result: p.lastResult!, read: p.lastRead, expected: p.lastExpected })),
  };
}

/** En az bir portalda ilan okunabildi mi (engel/okunamayan değil). */
export function hasReadResult(portals: readonly ScanRunPortal[]): boolean {
  return portals.some((p) => p.read > 0 && (p.result === "complete" || p.result === "partial"));
}

/** Portal ana sayfaları (kullanıcı oturum açıp tekrar dener). */
export const PORTAL_HOME: Record<string, string> = {
  sahibinden: "https://www.sahibinden.com/",
  hepsiemlak: "https://www.hepsiemlak.com/",
  emlakjet: "https://www.emlakjet.com/",
};

export const PORTAL_HOST_LABEL: Record<string, string> = { sahibinden: "sahibinden.com", hepsiemlak: "hepsiemlak.com", emlakjet: "emlakjet.com" };
