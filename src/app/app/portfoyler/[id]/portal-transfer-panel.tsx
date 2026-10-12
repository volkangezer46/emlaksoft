"use client";

import { useState, useTransition } from "react";
import { ArrowUpRight, CheckCircle2, Loader2, MonitorSmartphone, Send } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { bridgeInstalled, requestTransfer, type TransferResult } from "@/lib/listing-control/worker/bridge";
import { preparePortalTransfer, type PrepareTransferResult } from "@/app/actions/portal-transfer";

/**
 * "Portala aktar" (portföy detayı → Yayın ve portallar). Akış: 1) sunucu kısa ömürlü, TEK KULLANIMLIK aktarım kodu üretir
 * (`preparePortalTransfer`); 2) kod, sayfadan eklentiye verilir (köprü `transfer-request`); eklenti paketi ve fotoğrafları
 * EmlakSoft'tan alır; 3) kullanıcı portalın "İlan ver" sayfasında eklenti penceresinden "EmlakSoft'tan doldur"a basar;
 * 4) "Yayınla"ya KULLANICI basar; 5) ilan no/URL EmlakSoft'a geri bağlanır. Sunucu portala istek atmaz, ilan yayınlamaz.
 * Eksikler (hazırlık kontrolü) uyarıdır, ENGELLEMEZ. Mobilde eklenti çalışmadığı için düğme yerine bilgi gösterilir.
 */

export type TransferPortalState = {
  id: "sahibinden" | "hepsiemlak" | "emlakjet";
  label: string;
  live: { externalId: string | null; url: string | null } | null;
};

type Outcome = { prepared: Extract<PrepareTransferResult, { ok: true }>; bridge: TransferResult | null; noExtension: boolean };

export function PortalTransferPanel({ propertyId, portals, closed }: { propertyId: string; portals: TransferPortalState[]; closed: boolean }) {
  const [pending, start] = useTransition();
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Record<string, Outcome>>({});

  function run(portal: TransferPortalState["id"]) {
    setError(null);
    setActive(portal);
    start(async () => {
      const prepared = await preparePortalTransfer(propertyId, portal);
      if (!prepared.ok) {
        setError(prepared.error);
        return;
      }
      if (!bridgeInstalled()) {
        setOutcome((o) => ({ ...o, [portal]: { prepared, bridge: null, noExtension: true } }));
        return;
      }
      const bridge = await requestTransfer(prepared.code);
      setOutcome((o) => ({ ...o, [portal]: { prepared, bridge, noExtension: false } }));
    });
  }

  return (
    <section aria-label="Portala aktar" className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
      <div className="border-b border-line px-5 py-4">
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
          <Send className="h-4 w-4 text-brand-600" /> Portala aktar
        </h2>
        <p className="text-xs text-text-muted">
          Eklenti, portalın “İlan ver” formunu bu portföyün bilgi ve fotoğraflarıyla doldurur. “Yayınla”ya siz basarsınız; yayınlanınca ilan numarası portföye bağlanır.
        </p>
      </div>
      <p className="flex items-center gap-2 border-b border-line px-5 py-3 text-xs text-text-muted md:hidden">
        <MonitorSmartphone className="h-4 w-4 shrink-0" aria-hidden /> Portala aktarma, masaüstü tarayıcıda (Chrome/Edge) eklentiyle yapılır.
      </p>
      <div className="divide-y divide-line">
        {portals.map((p) => {
          const out = outcome[p.id];
          const busy = pending && active === p.id;
          return (
            <article key={p.id} className="px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-950">{p.label}</p>
                  {p.live ? (
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                      <Badge variant="success" size="sm">Yayında</Badge>
                      {p.live.externalId ? <span className="numeric">#{p.live.externalId}</span> : null}
                      {p.live.url ? (
                        <a href={p.live.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand-600">
                          İlanı aç <ArrowUpRight className="h-3 w-3" />
                        </a>
                      ) : null}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-xs text-text-muted">Bu portalda ilan kaydı yok.</p>
                  )}
                </div>
                <Button
                  variant={p.live ? "outline" : "primary"}
                  size="sm"
                  icon={Send}
                  loading={busy}
                  disabled={pending || closed}
                  onClick={() => run(p.id)}
                  className="hidden md:inline-flex"
                >
                  {p.live ? `${p.label}'e yeniden aktar` : `${p.label}'e aktar`}
                </Button>
              </div>

              {error && active === p.id && !pending ? <Alert tone="danger" className="mt-3">{error}</Alert> : null}

              {out ? (
                <div className="mt-3 space-y-3">
                  {out.noExtension ? (
                    <Alert
                      tone="warning"
                      title="Eklenti bulunamadı"
                      action={<ButtonLink href="/app/ilan-kontrol/eklenti" size="sm" variant="outline">Eklentiyi kur</ButtonLink>}
                    >
                      Bu tarayıcıda EmlakSoft İlan Kontrol eklentisi görünmüyor. Kurup bağlandıktan sonra tekrar “aktar” deyin.
                    </Alert>
                  ) : out.bridge?.ok ? (
                    <Alert tone="success" title="Paket eklentiye alındı">
                      {out.prepared.summary.fields} alan, {out.bridge.total} fotoğraf{out.bridge.total > 0 ? ` (${out.bridge.photos} hazır)` : ""}. {out.bridge.message}
                    </Alert>
                  ) : (
                    <Alert tone="danger" title="Eklentiye aktarılamadı">{out.bridge?.message ?? "Eklenti yanıt vermedi."}</Alert>
                  )}

                  {!out.noExtension && out.bridge?.ok ? (
                    <ol className="list-decimal space-y-1 pl-5 text-xs text-text-muted">
                      <li>
                        <a href={out.prepared.newListingUrl} target="_blank" rel="noreferrer" className="font-semibold text-brand-600">
                          {out.prepared.portalLabel} “İlan ver” sayfasını açın
                        </a>{" "}
                        ve kategoriyi (işlem ve portföy türü) kendiniz seçin.
                      </li>
                      <li>Form açıkken tarayıcınızdaki EmlakSoft eklentisine tıklayıp “EmlakSoft’tan doldur”a basın.</li>
                      <li>Konumu ve harita iğnesini kontrol edin; “Elle doldurun” listesindeki alanları tamamlayın.</li>
                      <li>“Yayınla”ya siz basın; sonra eklentide ilan numarasını EmlakSoft’a bağlayın.</li>
                    </ol>
                  ) : null}

                  {out.prepared.readiness.warnings.map((w) => (
                    <Alert key={w} tone="warning">{w}</Alert>
                  ))}
                  {out.prepared.readiness.missing.length > 0 ? (
                    <div>
                      <p className="text-xs font-semibold text-ink-950">Portföyde eksik olanlar (portal bunları isteyebilir)</p>
                      <ul className="mt-1.5 flex flex-wrap gap-1.5">
                        {out.prepared.readiness.missing.map((m) => (
                          <li key={String(m.key)}>
                            <Badge variant={m.level === "required" ? "warning" : "neutral"} size="sm">{m.label}</Badge>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1.5 text-xs text-text-muted">Eksikleri portföyü düzenleyerek (Özellikler sekmesi) ekleyebilirsiniz; aktarımı beklemek zorunda değilsiniz.</p>
                    </div>
                  ) : (
                    <p className="flex items-center gap-1.5 text-xs text-mint-600">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Zorunlu görünen tüm alanlar dolu.
                    </p>
                  )}
                  <p className="text-xs text-text-faint">
                    Aktarım kodu <span className="numeric font-mono">{out.prepared.code}</span> tek kullanımlıktır ve {out.prepared.ttlMinutes} dakika geçerlidir; eklenti kodu otomatik kullandı.
                  </p>
                </div>
              ) : busy ? (
                <p className="mt-3 flex items-center gap-2 text-xs text-text-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Paket hazırlanıyor ve fotoğraflar eklentiye alınıyor…
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
      {closed ? <p className="border-t border-line px-5 py-3 text-xs text-text-muted">Kapanmış portföy portala aktarılamaz.</p> : null}
    </section>
  );
}
