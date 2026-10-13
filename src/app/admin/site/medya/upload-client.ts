import type { SiteMediaActionResult } from "@/lib/site-media/upload";

/**
 * İstemci yükleme yardımcısı: dosya 4 MB'ı aşabildiği için sunucu eylemi yerine /admin/site/medya/yukle rotasına
 * multipart POST (kapı ve iş `runSiteMediaUpload` çekirdeğinde). Medya ekranı ve site içeriği görsel seçicisi ortak kullanır.
 */
export async function postSiteMedia(form: FormData): Promise<SiteMediaActionResult> {
  try {
    const res = await fetch("/admin/site/medya/yukle", { method: "POST", body: form, credentials: "same-origin" });
    if (!(res.headers.get("content-type") ?? "").includes("application/json")) {
      return { error: res.status === 413 ? "Dosya en fazla 8 MB olabilir." : "Oturum doğrulanamadı; sayfayı yenileyip tekrar deneyin." };
    }
    return (await res.json()) as SiteMediaActionResult;
  } catch {
    return { error: "Bağlantı hatası; tekrar deneyin." };
  }
}

/** Seçilen dosya için istemci tarafı ön kontrol (sunucu yine bayt imzasıyla doğrular). */
export const ACCEPT_IMAGES = "image/avif,image/webp,image/jpeg,image/png";
