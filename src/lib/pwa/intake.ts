/**
 * Saha girişleri (PWA paylaşım hedefi + çevrimdışı notlar) için SAF yardımcılar ve yerel depolama anahtarları.
 * İstemci ve testler kullanır; `phone-rules` STATİK içe alınmaz (paket bütçesi): telefon burada yalnız ADAY olarak
 * çıkarılır, kesin doğrulama kaydı yapan sunucu eyleminde (`parsePhoneStrict`) yapılır.
 *
 * Çevrimdışı not akışı (MP9): public/offline.html (statik, kişisel veri içermez) bağlantı yokken not alır ve
 * `OFFLINE_NOTES_KEY` altına yazar; her notu son oturumun kapsam izi (`OFFLINE_SCOPE_KEY`, kullanıcı+ofis kimliklerinin
 * özeti, kişisel veri değil) ile damgalar. Bağlantı gelince yalnız AYNI kapsamdaki oturum notları görür; başka
 * oturumun notları gösterilmez, yalnız silinebilir (ortak cihaz gizliliği).
 */

/** `emlaksoft:saha-` öneki bilinçli: çıkışta `clearFieldCaptureStorage` saha taslaklarıyla birlikte bu notları da siler. */
export const OFFLINE_NOTES_KEY = "emlaksoft:saha-cevrimdisi-not:v1";
export const OFFLINE_SCOPE_KEY = "emlaksoft:pwa-kapsam";
export const SHARE_CACHE = "es-share-inbox";

export type OfflineNote = { id: string; at: number; scope: string | null; name: string; phone: string; note: string };

function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

export function parseOfflineNotes(raw: string | null): OfflineNote[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((n) => n && typeof n === "object" && typeof n.id === "string")
      .slice(0, 50)
      .map((n) => ({
        id: clean(n.id, 64),
        at: Number(n.at) || 0,
        scope: typeof n.scope === "string" ? n.scope.slice(0, 64) : null,
        name: clean(n.name, 120),
        phone: clean(n.phone, 40),
        note: clean(n.note, 2000),
      }));
  } catch {
    return [];
  }
}

export function splitByScope(notes: OfflineNote[], scope: string): { mine: OfflineNote[]; foreign: OfflineNote[] } {
  const mine: OfflineNote[] = [];
  const foreign: OfflineNote[] = [];
  for (const n of notes) (n.scope && n.scope === scope ? mine : foreign).push(n);
  return { mine, foreign };
}

/** Metindeki ilk telefon ADAYI (TR cep/sabit ya da +uluslararası). Doğrulama sunucuda yapılır. */
export function extractPhoneCandidate(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = /(?:\+\d[\d\s()-]{8,18}\d|(?:\b0|\b)5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b|\b0[2-4]\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b)/.exec(text);
  if (!m) return null;
  const compact = m[0].replace(/[\s()-]/g, "");
  return compact.length >= 10 && compact.length <= 16 ? compact : null;
}

/** Paylaşımdaki ilk http(s) bağlantısı. */
export function extractUrl(...parts: (string | null | undefined)[]): string | null {
  for (const p of parts) {
    const m = /https?:\/\/[^\s<>"']+/i.exec(p ?? "");
    if (m) return m[0].replace(/[.,;)]+$/, "");
  }
  return null;
}

/** Bilinen ilan portalı mı? (bağlantı yalnız gösterilir; sunucu portala istek atmaz) */
export function listingPortal(url: string | null): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.endsWith("sahibinden.com")) return "sahibinden.com";
    if (host.endsWith("hepsiemlak.com")) return "Hepsiemlak";
    if (host.endsWith("emlakjet.com")) return "Emlakjet";
    return null;
  } catch {
    return null;
  }
}

/** vCard (.vcf) içinden ad ve ilk telefon. */
export function parseVcard(text: string): { name: string | null; phone: string | null } {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const fn = /^FN(?:;[^:\n]*)?:(.+)$/im.exec(unfolded)?.[1]?.trim() ?? null;
  let name = fn;
  if (!name) {
    const n = /^N(?:;[^:\n]*)?:(.+)$/im.exec(unfolded)?.[1];
    if (n) {
      const [last = "", first = ""] = n.split(";");
      name = `${first} ${last}`.trim() || null;
    }
  }
  const tel = /^TEL(?:;[^:\n]*)?:(.+)$/im.exec(unfolded)?.[1]?.trim() ?? null;
  return { name: name ? name.slice(0, 120) : null, phone: tel ? tel.replace(/[^\d+]/g, "").slice(0, 16) || null : null };
}
