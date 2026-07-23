import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Kullanım Şartları | EmlakSoft",
};

export default function KullanimSartlariPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="text-sm text-[var(--brand)] hover:underline">
        ← Ana sayfa
      </Link>
      <h1 className="mt-6 font-[family-name:var(--font-display)] text-3xl font-bold text-[var(--ink)]">
        Kullanım Şartları
      </h1>
      <p className="mt-4 text-[var(--ink)]/70 leading-relaxed">
        Bu sayfa taslaktır. Abonelik, deneme süresi, kabul edilebilir kullanım, sorumluluk
        sınırları ve fesih koşulları hukuki inceleme sonrası burada yer alacaktır.
      </p>
      <p className="mt-4 text-sm text-[var(--ink)]/50">Son güncelleme: Temmuz 2026</p>
    </main>
  );
}
