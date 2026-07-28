import Link from "next/link";
import { ArrowLeft, MessageSquareText, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import type { MessageTemplateRow } from "@/app/actions/message-templates";
import { TemplatesManager } from "./templates-manager";

export const metadata = { title: "Mesaj şablonları" };

export default async function MessageTemplatesSettingsPage() {
  const { tenantId } = await requireModulePage("settings");
  const supabase = await createClient();

  const { data } = await supabase
    .from("message_templates")
    .select("id, title, body, category, is_active, sort_order, usage_count")
    .eq("tenant_id", tenantId)
    .order("sort_order", { ascending: true })
    .order("usage_count", { ascending: false })
    .limit(200);

  const templates = (data ?? []) as MessageTemplateRow[];
  const activeCount = templates.filter((t) => t.is_active).length;
  const totalUsage = templates.reduce((sum, t) => sum + (t.usage_count ?? 0), 0);

  return (
    <div className="space-y-6">
      <Link
        href="/app/ayarlar"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" /> Ayarlara dön
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-4 text-white md:p-6">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-60 w-60 rounded-full bg-mint-500/30 blur-[80px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-mint-400">
              <MessageSquareText className="h-4 w-4" /> WhatsApp mesaj kütüphanesi
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold md:text-3xl">Mesaj şablonları</h1>
            <p className="mt-1 max-w-2xl text-sm text-white/60">
              Ofisinizin standart WhatsApp metinlerini bir kez yazın; danışman müşteri kartındaki
              WhatsApp düğmesinden şablonu seçsin, değişkenler otomatik dolsun. Mesaj kendi
              WhatsApp&apos;ınızdan gönderilir — otomatik gönderim yoktur.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-[14px] border border-white/12 bg-white/[0.05] px-5 py-3 text-center">
              <p className="font-display text-xl font-extrabold text-mint-300">{activeCount}</p>
              <p className="text-[11px] text-white/55">aktif şablon</p>
            </div>
            <div className="rounded-[14px] border border-white/12 bg-white/[0.05] px-5 py-3 text-center">
              <p className="font-display text-xl font-extrabold text-white">{totalUsage}</p>
              <p className="text-[11px] text-white/55">toplam kullanım</p>
            </div>
          </div>
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-3 rounded-[16px] border border-line bg-surface p-4 text-sm">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-amber-400/15 text-amber-600">
          <Sparkles className="h-4 w-4" />
        </span>
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-text-muted">
          Gövdede <code className="rounded bg-canvas px-1 py-0.5 font-semibold text-brand-600">{"{musteri}"}</code> gibi
          değişkenler kullanın — gönderim anında müşteri, portföy ve randevu bilgileriyle doldurulur.
          Değeri olmayan değişken sessizce silinir, metin bozulmaz.
        </p>
      </section>

      <TemplatesManager templates={templates} />
    </div>
  );
}
