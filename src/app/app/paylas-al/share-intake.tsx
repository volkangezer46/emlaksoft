"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Building2, ExternalLink, Images, Inbox, Loader2, Share2, Trash2, UserPlus, Zap } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { Button, ButtonLink } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { IntakeCustomerForm } from "@/components/app/intake-customer-form";
import { searchProperties } from "@/app/actions/lookup";
import { SHARE_CACHE, extractPhoneCandidate, extractUrl, listingPortal, parseVcard } from "@/lib/pwa/intake";
import type { WatermarkSettings } from "@/lib/watermark";

const PropertyMediaManager = dynamic(() => import("@/app/app/portfoyler/[id]/property-media-manager").then((m) => m.PropertyMediaManager), {
  loading: () => <div className="h-40 animate-pulse rounded-[var(--radius-card)] bg-canvas" />,
});

type Meta = { title: string; text: string; url: string; files: { path: string; name: string; type: string; size: number }[] };
type Loaded = { meta: Meta; images: File[]; previews: string[]; vcard: { name: string | null; phone: string | null } | null };
type Mode = "musteri" | "portfoy";

async function loadShare(key: string): Promise<Loaded | null> {
  if (typeof caches === "undefined") return null;
  const cache = await caches.open(SHARE_CACHE);
  const metaRes = await cache.match(`/__share/${key}/meta`);
  if (!metaRes) return null;
  const meta = (await metaRes.json()) as Meta;
  const images: File[] = [];
  let vcard: Loaded["vcard"] = null;
  for (const f of meta.files ?? []) {
    const res = await cache.match(f.path);
    if (!res) continue;
    const blob = await res.blob();
    if (f.type.startsWith("image/")) images.push(new File([blob], f.name || "fotograf.jpg", { type: f.type }));
    else if (/vcard|vcf/i.test(f.type) || /\.vcf$/i.test(f.name)) vcard = parseVcard(await blob.text());
  }
  return { meta, images, previews: images.map((img) => URL.createObjectURL(img)), vcard };
}

async function purgeShare(key: string) {
  try {
    const cache = await caches.open(SHARE_CACHE);
    const keys = await cache.keys();
    await Promise.all(keys.filter((r) => new URL(r.url).pathname.startsWith(`/__share/${key}/`)).map((r) => cache.delete(r)));
  } catch {
    /* önbellek yok */
  }
}

export function ShareIntake({
  shareKey,
  failed,
  canCreateCustomer,
  canEditProperty,
  canCreateProperty,
  brand,
}: {
  shareKey: string | null;
  failed: boolean;
  canCreateCustomer: boolean;
  canEditProperty: boolean;
  canCreateProperty: boolean;
  brand: { watermark: WatermarkSettings; officeName: string; logoUrl: string | null };
}) {
  const [state, setState] = useState<"loading" | "empty" | "ready">(shareKey ? "loading" : "empty");
  const [data, setData] = useState<Loaded | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [propertyId, setPropertyId] = useState<string>("");
  const [cleared, setCleared] = useState(false);
  const previewsRef = useRef<string[]>([]);

  useEffect(() => {
    if (!shareKey) return;
    let alive = true;
    loadShare(shareKey)
      .then((loaded) => {
        if (!alive) {
          loaded?.previews.forEach((u) => URL.revokeObjectURL(u));
          return;
        }
        previewsRef.current = loaded?.previews ?? [];
        setData(loaded);
        setState(loaded ? "ready" : "empty");
        if (loaded) {
          // Varsayılan hedef: fotoğraf varsa portföy, yoksa müşteri.
          setMode(loaded.images.length > 0 && canEditProperty ? "portfoy" : canCreateCustomer ? "musteri" : null);
        }
      })
      .catch(() => {
        if (alive) setState("empty");
      });
    return () => {
      alive = false;
      previewsRef.current.forEach((u) => URL.revokeObjectURL(u));
      previewsRef.current = [];
    };
  }, [shareKey, canCreateCustomer, canEditProperty]);

  async function clearShare() {
    if (shareKey) await purgeShare(shareKey);
    setCleared(true);
  }

  if (state === "loading") {
    return (
      <div className="flex items-center gap-2 rounded-[var(--radius-panel)] border border-line bg-surface p-5 text-sm text-text-muted" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Paylaşılan içerik açılıyor…
      </div>
    );
  }

  if (state === "empty" || !data || cleared) {
    return (
      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-[var(--radius-card)] bg-brand-600/10 text-brand-600">
          {cleared ? <Inbox className="h-6 w-6" aria-hidden /> : <Share2 className="h-6 w-6" aria-hidden />}
        </span>
        <h2 className="mt-3 text-base font-bold text-ink-950">
          {cleared ? "Paylaşım bu cihazdan temizlendi" : failed ? "Paylaşılan içerik alınamadı" : "Bekleyen paylaşım yok"}
        </h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-text-muted">
          Android telefonda galeriden ya da WhatsApp&apos;tan <strong>Paylaş → EmlakSoft</strong> seçtiğinizde fotoğraf, metin ve kişi kartları
          burada açılır. Bunun için uygulamanın ana ekrana eklenmiş olması gerekir.
        </p>
        <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
          <ButtonLink href="/app/hizli" icon={Zap}>
            Hızlı kayıt
          </ButtonLink>
          <ButtonLink href="/app" variant="outline">
            Ana ekrana dön
          </ButtonLink>
        </div>
      </section>
    );
  }

  const { meta, images, previews, vcard } = data;
  const sharedText = [meta.title, meta.text].filter(Boolean).join("\n").trim();
  const url = extractUrl(meta.url, meta.text, meta.title);
  const portal = listingPortal(url);
  const phone = vcard?.phone ?? extractPhoneCandidate(sharedText);
  const noteParts = [sharedText, url && !sharedText.includes(url) ? url : ""].filter(Boolean);
  const requestId = shareKey!.slice(shareKey!.indexOf("-") + 1);

  const modes: { id: Mode; label: string; icon: typeof UserPlus; show: boolean }[] = [
    { id: "musteri", label: "Müşteri olarak kaydet", icon: UserPlus, show: canCreateCustomer },
    { id: "portfoy", label: "Portföye fotoğraf ekle", icon: Images, show: canEditProperty && images.length > 0 },
  ];
  const visibleModes = modes.filter((m) => m.show);

  return (
    <div className="space-y-4">
      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
        <h2 className="text-sm font-bold text-ink-950">Paylaştığınız içerik</h2>
        {vcard?.name || vcard?.phone ? (
          <p className="mt-2 text-sm text-ink-950">
            Kişi kartı: <strong>{vcard.name ?? "İsimsiz"}</strong>
            {vcard.phone ? ` · ${vcard.phone}` : ""}
          </p>
        ) : null}
        {sharedText ? <p className="mt-2 whitespace-pre-line break-words text-sm text-text-muted">{sharedText}</p> : null}
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex min-h-11 max-w-full items-center gap-1.5 break-all text-sm font-semibold text-brand-600 hover:underline"
          >
            <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
            {portal ? `${portal} ilanını aç` : url}
          </a>
        ) : null}
        {previews.length > 0 ? (
          <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label={`${previews.length} fotoğraf`}>
            {previews.map((src, i) => (
              <li key={src} className="aspect-square overflow-hidden rounded-[var(--radius-control)] bg-canvas">
                {/* eslint-disable-next-line @next/next/no-img-element -- yerel blob önizlemesi (sunucuya gitmez) */}
                <img src={src} alt={`Paylaşılan fotoğraf ${i + 1}`} className="h-full w-full object-cover" />
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {visibleModes.length > 1 ? (
        <div role="radiogroup" aria-label="Ne yapmak istiyorsunuz?" className="grid grid-cols-2 gap-2">
          {visibleModes.map((m) => {
            const Icon = m.icon;
            const active = mode === m.id;
            return (
              <Button
                key={m.id}
                role="radio"
                aria-checked={active}
                variant={active ? "primary" : "outline"}
                size="lg"
                icon={Icon}
                onClick={() => setMode(m.id)}
                className="min-h-14 whitespace-normal"
              >
                {m.label}
              </Button>
            );
          })}
        </div>
      ) : null}

      {mode === "musteri" && canCreateCustomer ? (
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
          <h2 className="mb-3 text-sm font-bold text-ink-950">Yeni müşteri</h2>
          <IntakeCustomerForm requestId={requestId} defaultName={vcard?.name} defaultPhone={phone} defaultNote={noteParts.join("\n")} />
        </section>
      ) : null}

      {mode === "portfoy" && canEditProperty ? (
        <section className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4">
          <h2 className="text-sm font-bold text-ink-950">Fotoğrafları hangi portföye ekleyelim?</h2>
          <Combobox
            id="share-property"
            aria-label="Portföy"
            placeholder="Portföy ara ve seç"
            searchPlaceholder="Portföy no ya da başlık ara…"
            emptyText="Eşleşen portföy yok"
            onSearch={searchProperties}
            options={[]}
            onValueChange={setPropertyId}
            className="[&_button]:min-h-11"
          />
          {propertyId ? (
            <PropertyMediaManager
              key={propertyId}
              propertyId={propertyId}
              media={[]}
              canEdit
              watermark={brand.watermark}
              officeName={brand.officeName}
              logoUrl={brand.logoUrl}
              pendingFiles={images}
            />
          ) : canCreateProperty ? (
            <p className="text-xs text-text-muted">
              Portföy henüz kayıtlı değil mi?{" "}
              <Link href="/app/hizli?sekme=portfoy" className="font-semibold text-brand-600 hover:underline">
                Sahadan yeni portföy açın
              </Link>
              , ardından bu sayfaya dönüp fotoğrafları ekleyin.
            </p>
          ) : null}
        </section>
      ) : null}

      {visibleModes.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-line bg-surface p-4 text-sm text-text-muted">
          <Building2 className="mr-1 inline h-4 w-4" aria-hidden />
          Bu içerikle yapılabilecek bir işlem için yetkiniz yok.
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" icon={Trash2} onClick={() => void clearShare()}>
          Paylaşımı bu cihazdan temizle
        </Button>
      </div>
    </div>
  );
}
