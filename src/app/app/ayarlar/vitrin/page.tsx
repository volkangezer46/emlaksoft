import Link from "@/components/ui/smart-link";
import { redirect } from "next/navigation";
import { ArrowLeft, ExternalLink, Info } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { loadVitrinSettings } from "@/lib/vitrin-settings";
import { PageHeader } from "@/components/ui/page-header";
import { ReadOnlyGate } from "../read-only-gate";
import { VitrinForm } from "./vitrin-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vitrin ayarları" };

export default async function VitrinSettingsPage() {
  const ctx = await requireModulePage("settings");
  // Ofis bağlamı yoksa (platform personeli, impersonation dışı) vitrin ayarı yoktur.
  if (!ctx.tenantId) redirect("/app");
  const tenantId = ctx.tenantId;
  const supabase = await createClient();
  const [state, { data: tenant }] = await Promise.all([
    loadVitrinSettings(supabase, tenantId),
    supabase.from("tenants").select("slug").eq("id", tenantId).maybeSingle(),
  ]);
  const slug = (tenant as { slug: string | null } | null)?.slug ?? null;
  const canEdit = (ctx.perms.settings ?? []).includes("edit");

  return (
    <div className="space-y-6">
      <Link
        href="/app/ayarlar"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" /> Ayarlara dön
      </Link>

      <PageHeader
        title="Ofis vitrini"
        eyebrow="Vitrin ayarları"
        description="Herkese açık ofis vitrininde hangi bölümlerin görüneceğini, tanıtım metnini ve arama motorlarında görünüp görünmeyeceğini yönetin."
        actions={
          slug ? (
            <Link
              href={`/vitrin/${slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3.5 py-2 text-sm font-semibold text-ink-950 hover:bg-canvas"
            >
              <ExternalLink className="h-4 w-4" /> Vitrini aç
            </Link>
          ) : undefined
        }
      />

      {state.available ? (
        <section className="surface-card rounded-[var(--radius-panel)] p-4 md:p-6">
          <ReadOnlyGate canEdit={canEdit}>
            <VitrinForm settings={state.settings} />
          </ReadOnlyGate>
        </section>
      ) : (
        <section
          role="status"
          className="flex items-start gap-3 rounded-[var(--radius-panel)] border border-amber-400/40 bg-amber-400/10 p-4 md:p-6"
        >
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
          <div>
            <h2 className="font-display text-base font-bold text-ink-950">Vitrin ayarları henüz etkin değil</h2>
            <p className="mt-1 text-sm text-text-muted">
              Bu özellik veritabanı güncellemesi tamamlanınca açılır. O zamana kadar vitrininiz bugünkü haliyle çalışır ve
              arama motoru site haritasına yalnızca platform yöneticisinin onayladığı ofisler girer.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
