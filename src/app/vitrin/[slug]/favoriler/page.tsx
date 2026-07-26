import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Heart } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { FavorilerClient } from "./favoriler-client";

/**
 * Vitrin favoriler sayfası — SSR kabuğu kişisel veri içermez (ISR güvenli):
 * favori id'leri client'ta localStorage'dan okunur, kart verisi public
 * /api/vitrin-favoriler ucundan gelir. Ziyaretçiye hesap gerekmez.
 */
export const revalidate = 120;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const admin = createAdminClient();
  const { data: tenant } = await admin.from("tenants").select("name").eq("slug", slug).maybeSingle();
  if (!tenant) return { title: "Vitrin bulunamadı" };
  const title = `Favorilerim | ${tenant.name}`;
  return {
    title: { absolute: title },
    description: `${tenant.name} vitrininde beğendiğiniz portföyler — bu cihazda saklanır, hesap gerekmez.`,
    // Kişisel görünüm — arama motoruna girmesin
    robots: { index: false },
    alternates: { canonical: `/vitrin/${slug}/favoriler` },
  };
}

export default async function VitrinFavorilerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const admin = createAdminClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, brand_color")
    .eq("slug", slug)
    .maybeSingle();
  if (!tenant) notFound();

  return (
    <div className="min-h-screen bg-canvas">
      {/* Kompakt koyu üst şerit — vitrin ana sayfa hero'sunun kısaltılmışı */}
      <header className="theme-dark relative overflow-hidden bg-[image:var(--grad-ink)] text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="relative mx-auto max-w-6xl px-4 py-8">
          <Link
            href={`/vitrin/${slug}`}
            className="focus-ring flex w-fit items-center gap-3 rounded-[14px] transition hover:opacity-90"
          >
            <span
              className="grid h-11 w-11 place-items-center rounded-[13px] text-base font-extrabold text-white"
              style={{ background: tenant.brand_color || "var(--grad-brand)" }}
            >
              {tenant.name ? tenant.name[0] : "E"}
            </span>
            <span>
              <span className="block font-display text-lg font-extrabold">{tenant.name}</span>
              <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-mint-400">
                Portföy vitrini
              </span>
            </span>
          </Link>
          <h1 className="mt-5 flex items-center gap-2 font-display text-2xl font-extrabold sm:text-3xl">
            <Heart className="h-6 w-6 fill-red-500 text-red-500" /> Favorilerim
          </h1>
          <p className="mt-1 max-w-xl text-sm text-white/60">
            Beğendiğiniz portföyler bu cihazda saklanır — hesap gerekmez.
          </p>
          <Link
            href={`/vitrin/${slug}`}
            className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs font-bold text-white/70 transition hover:bg-white/10"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> İlanlara dön
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10">
        <FavorilerClient slug={slug} />
      </main>

      <footer className="border-t border-line py-6 text-center text-[11px] text-text-faint">
        <Link href="/" className="font-semibold underline-offset-2 transition hover:text-brand-600 hover:underline">
          Powered by EmlakSoft
        </Link>{" "}
        — Türkiye&apos;nin emlak işletim sistemi
      </footer>
    </div>
  );
}
