import Link from "next/link";

import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/store";

// Başlık/açıklama/OG varsayılanları src/lib/seo/registry.ts'te; /admin/seo'dan geçersiz kılınır.
export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata("/demo");
}
import { CalendarDays } from "lucide-react";
import { getLiveSiteContent } from "@/lib/site-content/store";
import { DemoForm } from "./demo-form";

export default async function DemoPage() {
  const { demo } = await getLiveSiteContent();
  return (
    <div className="flex min-h-screen items-center justify-center bg-[image:var(--grad-ink)] px-4 py-12">
      <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
      <div className="relative w-full max-w-lg overflow-hidden rounded-[var(--radius-panel)] border border-white/15 bg-surface shadow-[var(--shadow-lg)]">
        <div className="theme-dark relative bg-[image:var(--grad-ink)] px-8 py-6 text-white">
          <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
          <div className="relative flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-white/10 text-mint-400">
              <CalendarDays className="h-5 w-5" />
            </span>
            <div>
              <h1 className="font-display text-2xl font-extrabold text-white">{demo.title}</h1>
              <p className="mt-1 text-sm text-white/60">{demo.text}</p>
            </div>
          </div>
        </div>
        <div className="p-8">
          <DemoForm />
          <Link href="/" className="mt-6 inline-block text-sm font-semibold text-brand-600 hover:underline">
            Ana sayfaya dön
          </Link>
        </div>
      </div>
    </div>
  );
}
