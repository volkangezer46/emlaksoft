import { FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getConnectionInfo } from "@/lib/integrations/einvoice/service";
import { EInvoiceConnectPanel, type EInvoiceConnectionView } from "./einvoice-connect-panel";

/** Ayarlar > Entegrasyonlar: e-Fatura kartı (sağlayıcı seç -> anahtar bağla -> bağlantıyı test et). Tüm paketlerde, ek ücretsiz. */
export async function EInvoiceCard({ canEdit }: { canEdit: boolean }) {
  const supabase = await createClient();
  const { info, available } = await getConnectionInfo(supabase);
  const view: EInvoiceConnectionView | null = info
    ? {
        provider: info.provider,
        mode: info.mode,
        status: info.status,
        fingerprint: info.fingerprint,
        companyName: info.company_name,
        lastTestAt: info.last_test_at,
        lastTestOk: info.last_test_ok,
        lastError: info.last_error,
      }
    : null;

  return (
    <section id="e-fatura" className="scroll-mt-24">
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-600">
          <FileText className="h-4.5 w-4.5" />
        </span>
        <div>
          <h2 className="font-display text-base font-bold text-ink-950">e-Fatura</h2>
          <p className="text-xs text-text-muted">
            Komisyon ve hizmet bedeli için e-Fatura / e-Arşiv kesin. Tüm paketlerde, ek ücretsiz. Faturalar Finans sayfasının Faturalar sekmesinde görünür.
          </p>
        </div>
      </div>
      <div className="mt-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
        {available ? (
          <EInvoiceConnectPanel connection={view} canEdit={canEdit} />
        ) : (
          <p className="text-sm text-text-muted">e-Fatura henüz etkin değil (veritabanı güncellemesi bekleniyor).</p>
        )}
      </div>
    </section>
  );
}
