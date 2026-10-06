import Link from "next/link";
import { ShieldCheck } from "lucide-react";

/**
 * Liste sayfası başında küçük kapsam rozeti: "Kapsam: Takım (Satış A)". Yalnız kapsam listeyi
 * gerçekten DARALTIYORSA çizilir (ofis geneli görende hiçbir şey görünmez: gürültü yok).
 * Tıklanınca yetkilendirme ekranına gider (sıfır çıkmaz metrik).
 */
export function ScopeBadge({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <Link
      href="/app/ayarlar/yetkilendirme"
      title="Bu listede yalnız kapsamınızdaki kayıtlar görünür. Kapsamı yöneticiniz belirler."
      className="focus-ring inline-flex items-center gap-1.5 rounded-full border border-amber-400/50 bg-amber-400/10 px-2.5 py-1 text-xs font-semibold text-amber-700 transition hover:border-amber-500 hover:bg-amber-400/20"
    >
      <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
      {text}
    </Link>
  );
}
