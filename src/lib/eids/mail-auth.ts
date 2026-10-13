/**
 * EİDS e-postası kaynak doğrulama SINIFLANDIRMASI — SAF. Kriptografik doğrulamayı yapmaz; doğrulayıcıların
 * (SMTP alıcısında mailauth, .eml yüklemede `dkim.ts`) ürettiği kanıtı tek kurala göre sınıflandırır:
 *
 *  1) DKIM d=ticaret.gov.tr (veya alt alanı) GEÇERLİ → 'verified'.
 *  2) Değilse ARC zinciri geçerli VE güvenilir bir mühürleyicinin (google.com, outlook/microsoft, yandex)
 *     ARC-Authentication-Results'ında spf=pass smtp.mailfrom=…ticaret.gov.tr varsa → 'verified_via_arc'.
 *     Kayıtta gönderen IP'si yazıyorsa Bakanlık SPF adreslerinden biri olmalı (95.0.51.137 / 95.0.51.141).
 *  3) Doğrudan gelen e-postada (iletilmemiş) SPF pass (mailfrom ticaret.gov.tr) VE DMARC pass → 'verified'.
 *  4) Diğer her durum → 'unverified' (hiçbir durumu kendiliğinden değiştirmez; kontrol kuyruğuna düşer).
 * Header From eids.yetki@ticaret.gov.tr değilse sınıflandırma yapılmaz: çağıran 'rejected' yazar (gövde saklanmaz).
 */
import { EIDS_DOMAIN } from "./mail-parse";

export type MailAuthResult = "verified" | "verified_via_arc" | "unverified" | "rejected";

export type DkimEvidence = { domain: string; result: string };
export type ArcSetEvidence = { i: number; sealer: string; aar: string };
export type MailAuthEvidence = {
  dkim: DkimEvidence[];
  /** ARC zincirinin kriptografik sonucu (pass | fail | none) ve kümeler (mühürleyici + AAR metni). */
  arc: { result: string; sets: ArcSetEvidence[] } | null;
  /** SMTP oturumundaki SPF (yalnız doğrudan alımda anlamlı). */
  spf: { result: string; domain: string | null } | null;
  dmarc: { result: string } | null;
};

export const TRUSTED_ARC_SEALERS = ["google.com", "microsoft.com", "outlook.com", "office365.com", "yandex.ru", "yandex.com", "yandex.net", "yandex.com.tr"] as const;
export const EIDS_SPF_IPS = ["95.0.51.137", "95.0.51.141"] as const;

export type MailAuthClassification = { result: Exclude<MailAuthResult, "rejected">; reason: string };

function isDomainOrSub(domain: string | null | undefined, base: string): boolean {
  const d = (domain ?? "").trim().toLowerCase().replace(/\.$/, "");
  return d === base || d.endsWith(`.${base}`);
}

export function isTrustedSealer(domain: string): boolean {
  return TRUSTED_ARC_SEALERS.some((t) => isDomainOrSub(domain, t));
}

/** AAR metni Bakanlık için SPF geçti diyor mu (IP yazılıysa izinli listede mi)? */
export function aarShowsEidsSpfPass(aar: string): boolean {
  const text = aar.replace(/\s+/g, " ");
  // "spf=pass (... designates 95.0.51.137 as permitted sender) smtp.mailfrom=eids.yetki@ticaret.gov.tr"
  const m = /\bspf\s*=\s*pass\b([^;]*)/i.exec(text);
  if (!m) return false;
  const seg = m[1] ?? "";
  const mailfrom = /smtp\.mailfrom\s*=\s*"?([^\s;"]+)/i.exec(seg)?.[1] ?? "";
  const domain = mailfrom.includes("@") ? mailfrom.split("@").pop()! : mailfrom;
  if (!isDomainOrSub(domain, EIDS_DOMAIN)) return false;
  const ips = seg.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [];
  if (ips.length > 0 && !ips.every((ip) => (EIDS_SPF_IPS as readonly string[]).includes(ip))) return false;
  return true;
}

export function classifyMailAuth(e: MailAuthEvidence, opts: { direct: boolean }): MailAuthClassification {
  const dkimOk = e.dkim.find((d) => d.result === "pass" && isDomainOrSub(d.domain, EIDS_DOMAIN));
  if (dkimOk) return { result: "verified", reason: `dkim=pass d=${dkimOk.domain}` };

  if (e.arc && e.arc.result === "pass") {
    const set = [...e.arc.sets].sort((a, b) => a.i - b.i).find((s) => isTrustedSealer(s.sealer) && aarShowsEidsSpfPass(s.aar));
    if (set) return { result: "verified_via_arc", reason: `arc=pass i=${set.i} sealer=${set.sealer} spf=pass` };
  }

  if (opts.direct && e.spf?.result === "pass" && isDomainOrSub(e.spf.domain, EIDS_DOMAIN) && e.dmarc?.result === "pass") {
    return { result: "verified", reason: "spf=pass dmarc=pass (doğrudan)" };
  }

  const parts = [
    e.dkim.length ? `dkim=${e.dkim.map((d) => `${d.result}:${d.domain}`).join(",")}` : "dkim=none",
    `arc=${e.arc?.result ?? "none"}`,
    `spf=${e.spf?.result ?? "none"}`,
  ];
  return { result: "unverified", reason: parts.join(" ") };
}

/** Kısa Türkçe etiket (kuyruk ve kart). */
export const MAIL_AUTH_LABELS: Record<MailAuthResult, string> = {
  verified: "Doğrulandı",
  verified_via_arc: "Doğrulandı (iletim zinciri)",
  unverified: "Doğrulanamadı",
  rejected: "Reddedildi",
};

export function isVerifiedAuth(r: MailAuthResult | string | null | undefined): boolean {
  return r === "verified" || r === "verified_via_arc";
}
