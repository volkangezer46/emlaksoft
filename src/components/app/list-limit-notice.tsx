import { Info } from "lucide-react";
import Link from "next/link";

/**
 * "Bu listede her şey yok" uyarısı.
 *
 * NEDEN VAR: Panelde **25 liste sayfasında `.limit()` vardı ve hiçbiri
 * kullanıcıya bunu söylemiyordu.** 600 müşterisi olan bir ofis 500 kayıt
 * görüyor, kalan 100'den haberi olmuyordu. Üstelik sayfa üstündeki "N sonuç"
 * rozeti çekilen kümenin sayısıydı, gerçek toplam değil — yani sayı doğru
 * görünüyor ama yanlış şeyi sayıyordu.
 *
 * Sessiz kırpma en sinsi hata türü: ekranda hiçbir şey bozuk görünmez,
 * kullanıcı aradığı kaydı bulamaz ve "sistemde yok" sanır.
 *
 * KULLANIM: Sorguya `{ count: "exact" }` ekleyip dönen `count` ile birlikte
 * verin. Ek sorgu gerekmiyor — PostgREST sayıyı aynı yanıtta döndürür.
 *
 *   const { data, count } = await supabase
 *     .from("customers")
 *     .select("...", { count: "exact" })
 *     .limit(500);
 *
 *   <ListLimitNotice shown={rows.length} total={count} />
 */
export function ListLimitNotice({
  shown,
  total,
  /** Aramayı daraltmayı öneren metin; sayfaya göre değişebilir. */
  hint = "Aramayı daraltın ya da filtre uygulayın.",
  /** Varsa "tümünü gör" bağlantısı (rapor/dışa aktarım sayfası gibi). */
  href,
  hrefLabel,
}: {
  shown: number;
  total: number | null | undefined;
  hint?: string;
  href?: string;
  hrefLabel?: string;
}) {
  // Sayım gelmediyse ya da her şey ekrandaysa uyarı gösterme.
  if (total == null || total <= shown) return null;

  const gizli = total - shown;

  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[12px] border border-amber-400/35 bg-amber-400/[0.07] px-4 py-2.5 text-xs text-ink-950">
      <Info className="h-3.5 w-3.5 shrink-0 text-amber-500" />
      <span>
        Toplam <strong className="numeric">{total.toLocaleString("tr-TR")}</strong> kayıttan{" "}
        <strong className="numeric">{shown.toLocaleString("tr-TR")}</strong> tanesi listeleniyor —{" "}
        <strong className="numeric">{gizli.toLocaleString("tr-TR")}</strong> kayıt bu listede yok.
      </span>
      <span className="text-text-muted">{hint}</span>
      {href ? (
        <Link href={href} className="focus-ring font-semibold text-brand-600 hover:underline">
          {hrefLabel ?? "Tümünü gör"}
        </Link>
      ) : null}
    </p>
  );
}
