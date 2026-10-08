import Link from "@/components/ui/smart-link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import type { MessageTemplateRow } from "@/app/actions/message-templates";
import { ReadOnlyGate } from "../read-only-gate";
import { TemplatesManager } from "./templates-manager";

import { PageHeader } from "@/components/ui/page-header";
export const metadata = { title: "Mesaj şablonları" };

export default async function MessageTemplatesSettingsPage() {
  const { tenantId, perms } = await requireModulePage("settings");
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

      <PageHeader title="Mesaj şablonları" eyebrow="WhatsApp mesaj kütüphanesi" description="Ofisinizin standart WhatsApp metinlerini bir kez yazın; danışman müşteri kartındaki WhatsApp düğmesinden şablonu seçsin, değişkenler otomatik dolsun. Mesaj kendi WhatsApp'ınızdan gönderilir — otomatik gönderim yoktur." />

      <section className="theme-dark grid gap-3 rounded-[var(--radius-panel)] bg-[image:var(--grad-ink)] p-3 sm:p-4">
<div className="flex flex-wrap items-center gap-3">
            <div className="rounded-[var(--radius-card)] border border-white/12 bg-white/[0.05] px-5 py-3 text-center">
              <p className="font-display text-xl font-extrabold text-mint-300">{activeCount}</p>
              <p className="text-xs text-white/55">aktif şablon</p>
            </div>
            <div className="rounded-[var(--radius-card)] border border-white/12 bg-white/[0.05] px-5 py-3 text-center">
              <p className="font-display text-xl font-extrabold text-white">{totalUsage}</p>
              <p className="text-xs text-white/55">toplam kullanım</p>
            </div>
          </div>
      </section>

      <section className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 text-sm">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-amber-400/15 text-amber-600">
          <Sparkles className="h-4 w-4" />
        </span>
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-text-muted">
          Gövdede <code className="rounded bg-canvas px-1 py-0.5 font-semibold text-brand-600">{"{musteri}"}</code> gibi
          değişkenler kullanın — gönderim anında müşteri, portföy ve randevu bilgileriyle doldurulur.
          Değeri olmayan değişken sessizce silinir, metin bozulmaz.
        </p>
      </section>

      <ReadOnlyGate canEdit={(perms.settings ?? []).includes("edit")}>
        <TemplatesManager templates={templates} />
      </ReadOnlyGate>
    </div>
  );
}
