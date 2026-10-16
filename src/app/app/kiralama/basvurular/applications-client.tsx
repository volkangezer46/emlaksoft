"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Columns3, Link2, Link2Off, MessageCircle, RefreshCw } from "lucide-react";
import { closeApplicationLink, createApplicationLink } from "@/app/actions/rental-applications";
import { searchProperties } from "@/app/actions/lookup";
import { useToast } from "@/components/app/toast-provider";
import { CopyTextButton } from "@/components/app/copy-text-button";
import { Button, ButtonLink } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField, FormInput } from "@/components/ui/form-controls";
import { InlinePanel, InlinePanelTrigger } from "@/components/ui/inline-panel";
import { BulkBar } from "@/components/ui/list-kit/bulk-bar";
import { Checkbox } from "@/components/ui/checkbox";
import { COMPARE_MAX } from "@/lib/rentals/applications";

const PANEL_ID = "basvuru-baglantisi";

function waHref(url: string, label: string) {
  return `https://wa.me/?text=${encodeURIComponent(`${label} için kiracı başvurusu: ${url}`)}`;
}

export function NewLinkTrigger() {
  return (
    <InlinePanelTrigger panelId={PANEL_ID} icon={Link2} size="sm">
      Başvuru bağlantısı
    </InlinePanelTrigger>
  );
}

/**
 * Portföy için başvuru bağlantısı paneli. Portföyde açık bağlantı varsa aynısı döner (ilandaki link bozulmaz).
 * Sonuç: kopyala + WhatsApp ile paylaş; bağlantı ilan açıklamasına/portala eklenebilir.
 */
export function NewLinkPanel({ properties }: { properties: { id: string; label: string; hint?: string }[] }) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();
  const [propertyId, setPropertyId] = useState("");
  const [rent, setRent] = useState("");
  const [result, setResult] = useState<{ url: string; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    start(async () => {
      const res = await createApplicationLink({ propertyId, askingRent: rent });
      if (res.error || !res.url) {
        setError(res.error ?? "Bağlantı oluşturulamadı.");
        return;
      }
      const label = properties.find((p) => p.id === propertyId)?.label ?? "Kiralık daire";
      setResult({ url: res.url, label });
      push("Başvuru bağlantısı hazır", "ok");
      router.refresh();
    });
  };

  return (
    <InlinePanel id={PANEL_ID} title="Başvuru bağlantısı" description="Kiralık ilana tek bağlantı: adaylar telefondan başvurur, kefil ve evrak ekler." icon={<Link2 />}>
      <div className="space-y-4 px-4 py-4 md:px-6">
        {result ? (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-ink-950">{result.label}</p>
            <p className="break-all rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 font-mono text-xs text-ink-950">{result.url}</p>
            <div className="flex flex-wrap gap-2">
              <CopyTextButton text={result.url} label="Bağlantıyı kopyala" doneMessage="Bağlantı kopyalandı" variant="primary" size="md" />
              <ButtonLink href={waHref(result.url, result.label)} target="_blank" rel="noopener noreferrer" variant="outline" icon={MessageCircle}>
                WhatsApp ile paylaş
              </ButtonLink>
              <Button variant="ghost" onClick={() => { setResult(null); setPropertyId(""); setRent(""); }}>
                Başka portföy
              </Button>
            </div>
            <p className="text-xs text-text-muted">Bağlantıyı ilan açıklamasına ekleyebilirsiniz. Kiracı bulununca listeden kapatın.</p>
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <FormField label="Kiralık portföy" htmlFor="ra-link-property" required inject={false}>
                <Combobox
                  id="ra-link-property"
                  aria-label="Kiralık portföy"
                  placeholder="Portföy seçin"
                  searchPlaceholder="Kod ya da başlık ara…"
                  emptyText="Eşleşen portföy yok"
                  clearable={false}
                  value={propertyId}
                  onValueChange={setPropertyId}
                  onSearch={searchProperties}
                  options={properties.map((p) => ({ value: p.id, label: p.label, hint: p.hint }))}
                />
              </FormField>
              <FormField label="Aylık kira (TL)" htmlFor="ra-link-rent" hint="Boşsa ilan fiyatı kullanılır.">
                <FormInput inputMode="decimal" placeholder="Örn. 25.000" value={rent} onChange={(e) => setRent(e.target.value)} />
              </FormField>
            </div>
            {error ? <p role="alert" className="text-sm font-medium text-danger-600">{error}</p> : null}
            <Button icon={Link2} loading={pending} disabled={!propertyId} onClick={submit}>
              Bağlantıyı oluştur
            </Button>
          </>
        )}
      </div>
    </InlinePanel>
  );
}

/** Açık bağlantı satırı eylemleri: kopyala, WhatsApp, yenile (eskiyi iptal eder), kapat. Hover'a bağlı eylem yok. */
export function LinkActions({ linkId, propertyId, url, label }: { linkId: string; propertyId: string; url: string; label: string }) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();
  const renew = () =>
    start(async () => {
      const res = await createApplicationLink({ propertyId, renew: true });
      if (res.error) push(res.error, "err");
      else {
        push("Yeni bağlantı oluşturuldu; eski bağlantı artık çalışmaz.", "ok");
        router.refresh();
      }
    });
  const close = async () => {
    const res = await closeApplicationLink(linkId);
    if (res.error) push(res.error, "err");
    else {
      push("Başvuru bağlantısı kapatıldı", "ok");
      router.refresh();
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <CopyTextButton text={url} label="Kopyala" doneMessage="Bağlantı kopyalandı" />
      <ButtonLink href={waHref(url, label)} target="_blank" rel="noopener noreferrer" variant="outline" size="sm" icon={MessageCircle}>
        WhatsApp
      </ButtonLink>
      <ConfirmDialog
        trigger={<Button variant="ghost" size="sm" icon={RefreshCw} loading={pending}>Yenile</Button>}
        title="Bağlantıyı yenile"
        description="Eski bağlantı çalışmaz hale gelir ve yeni bir bağlantı oluşturulur. İlanlardaki bağlantıyı güncellemeniz gerekir."
        confirmLabel="Yenile"
        tone="default"
        onConfirm={renew}
      />
      <ConfirmDialog
        trigger={<Button variant="ghost" size="sm" icon={Link2Off}>Kapat</Button>}
        title="Başvuruları kapat"
        description="Bu bağlantıdan yeni başvuru alınmaz. Gelen başvurular listede kalır."
        confirmLabel="Kapat"
        onConfirm={close}
      />
    </div>
  );
}

type CompareCtx = { selected: string[]; toggle: (id: string) => void; clear: () => void };
const Ctx = createContext<CompareCtx | null>(null);

/** Karşılaştırma seçimi (en çok 4 aday). Seçim varken listenin üstünde yapışkan çubuk belirir. */
export function CompareProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<string[]>([]);
  const { push } = useToast();
  const toggle = (id: string) =>
    setSelected((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= COMPARE_MAX) {
        push(`En çok ${COMPARE_MAX} aday karşılaştırılabilir.`, "err");
        return cur;
      }
      return [...cur, id];
    });
  const clear = () => setSelected([]);
  return (
    <Ctx.Provider value={{ selected, toggle, clear }}>
      {selected.length > 0 ? (
        <BulkBar count={selected.length} noun="aday" onClear={clear}>
          <ButtonLink
            href={`/app/kiralama/basvurular/karsilastir?ids=${selected.join(",")}`}
            size="sm"
            icon={Columns3}
            aria-disabled={selected.length < 2}
            className={selected.length < 2 ? "pointer-events-none opacity-55" : undefined}
          >
            Yan yana karşılaştır
          </ButtonLink>
          {selected.length < 2 ? <span className="text-xs text-text-muted">En az 2 aday seçin</span> : null}
        </BulkBar>
      ) : null}
      {children}
    </Ctx.Provider>
  );
}

export function CompareCheckbox({ id, name }: { id: string; name: string }) {
  const ctx = useContext(Ctx);
  if (!ctx) return null;
  const checked = ctx.selected.includes(id);
  return (
    <label className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center" title="Karşılaştırmaya ekle">
      <Checkbox checked={checked} onChange={() => ctx.toggle(id)} aria-label={`${name} adayını karşılaştırmaya ekle`} />
    </label>
  );
}
