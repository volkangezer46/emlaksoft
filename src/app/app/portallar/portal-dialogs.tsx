"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  Link2,
  Plus,
  RadioTower,
  Siren,
  X,
} from "lucide-react";
import {
  closePortalListing,
  createPortalListing,
} from "@/app/actions/portal-listings";

type PropertyOption = { id: string; property_code: string; title: string | null };

const inputClass =
  "w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface";

export function NewPortalDialog({ properties }: { properties: PropertyOption[] }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  async function submit(formData: FormData) {
    setPending(true);
    setError(null);
    const result = await createPortalListing(formData);
    setPending(false);
    if (result.ok) {
      formRef.current?.reset();
      setOpen(false);
      router.refresh();
    } else {
      setError(result.error ?? "Portal ilanı eklenemedi.");
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} disabled={properties.length === 0} className="btn-shine inline-flex items-center gap-2 rounded-[11px] bg-white px-4 py-2.5 text-sm font-bold text-ink-950 disabled:cursor-not-allowed disabled:opacity-50">
        <Plus className="h-4 w-4" /> Portal ilanı ekle
      </button>
      {open ? (
        <DialogShell title="Portal ilanı bağla" description="Portföyü yayın ağına ekleyin." icon={RadioTower} onClose={() => setOpen(false)}>
          <form ref={formRef} action={submit} className="grid gap-4 p-6">
            <label className="text-sm font-medium text-ink-950">
              Portföy *
              <div className="relative mt-1.5">
                <select name="property_id" required defaultValue="" className={`${inputClass} appearance-none`}>
                  <option value="" disabled>Portföy seçin</option>
                  {properties.map((property) => <option key={property.id} value={property.id}>{property.property_code} · {property.title ?? "İsimsiz portföy"}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
              </div>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-ink-950">
                Portal *
                <select name="portal_name" required defaultValue="Sahibinden" className={`${inputClass} mt-1.5`}>
                  {["Sahibinden", "Hepsiemlak", "Emlakjet", "EmlakSoft vitrin", "Diğer"].map((portal) => <option key={portal}>{portal}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium text-ink-950">
                İlan numarası
                <input name="portal_listing_id" className={`${inputClass} mt-1.5`} placeholder="128874" />
              </label>
            </div>
            <label className="text-sm font-medium text-ink-950">
              İlan bağlantısı
              <div className="relative mt-1.5">
                <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                <input name="portal_url" type="url" className={`${inputClass} pl-10`} placeholder="https://…" />
              </div>
            </label>
            {error ? <p role="alert" className="text-sm text-danger-500">{error}</p> : null}
            <DialogActions pending={pending} submitLabel="Yayın ağına ekle" onCancel={() => setOpen(false)} />
          </form>
        </DialogShell>
      ) : null}
    </>
  );
}

export function ClosePortalDialog({
  listingId,
  label,
}: {
  listingId: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function submit(formData: FormData) {
    setPending(true);
    setError(null);
    const result = await closePortalListing(formData);
    setPending(false);
    if (result.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setError(result.error ?? "Kapanış kaydedilemedi.");
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-[9px] border border-danger-500/20 px-3 py-2 text-xs font-semibold text-danger-500 transition hover:bg-danger-500/8">Kapat</button>
      {open ? (
        <DialogShell title="İlan kapanış formu" description={label} icon={Siren} onClose={() => setOpen(false)} danger>
          <form action={submit} className="grid gap-4 p-6">
            <input type="hidden" name="portal_listing_id" value={listingId} />
            <label className="text-sm font-medium text-ink-950">
              Kapanış nedeni *
              <select name="reason" required defaultValue="" className={`${inputClass} mt-1.5`}>
                <option value="" disabled>Neden seçin</option>
                {["Kendi satışımız", "Rakip kapattı", "Mülk sahibi vazgeçti", "Yetki süresi doldu", "Fiyat/şart değişti", "Bilinmiyor"].map((reason) => <option key={reason}>{reason}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium text-ink-950">
              İşlem bedeli
              <input name="deal_amount" inputMode="decimal" className={`${inputClass} mt-1.5`} placeholder="6.750.000" />
            </label>
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                ["deal_happened", "İşlem gerçekleşti"],
                ["closed_by_us", "Biz kapattık"],
                ["competitor_closed", "Rakip kapattı"],
              ].map(([name, text]) => (
                <label key={name} className="flex items-center gap-2 rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-xs font-medium text-text-muted">
                  <input type="checkbox" name={name} className="accent-brand-600" /> {text}
                </label>
              ))}
            </div>
            <div className="rounded-[11px] border border-danger-500/20 bg-danger-500/5 px-4 py-3 text-xs text-danger-500">Bu kayıt kayıp-kaçak analizine dahil edilir ve sonradan denetlenebilir.</div>
            {error ? <p role="alert" className="text-sm text-danger-500">{error}</p> : null}
            <DialogActions pending={pending} submitLabel="Kapanışı kaydet" onCancel={() => setOpen(false)} danger />
          </form>
        </DialogShell>
      ) : null}
    </>
  );
}

function DialogShell({
  title,
  description,
  icon: Icon,
  onClose,
  danger = false,
  children,
}: {
  title: string;
  description: string;
  icon: typeof RadioTower;
  onClose: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/55 p-4 backdrop-blur-md sm:items-center">
      <div className="w-full max-w-xl overflow-hidden rounded-[22px] border border-white/20 bg-surface shadow-[var(--shadow-lg)]">
        <div className="theme-dark relative overflow-hidden bg-[image:var(--grad-ink)] px-6 py-5 text-white">
          <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className={`grid h-11 w-11 place-items-center rounded-[13px] ${danger ? "bg-danger-500/15 text-danger-500" : "bg-white/10 text-mint-400"}`}><Icon className="h-5 w-5" /></span>
              <div><h2 className="font-display text-lg font-bold text-white">{title}</h2><p className="text-xs text-white/55">{description}</p></div>
            </div>
            <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-[10px] bg-white/8 text-white/70" aria-label="Kapat"><X className="h-5 w-5" /></button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function DialogActions({
  pending,
  submitLabel,
  onCancel,
  danger = false,
}: {
  pending: boolean;
  submitLabel: string;
  onCancel: () => void;
  danger?: boolean;
}) {
  return (
    <div className="flex justify-end gap-2 border-t border-line pt-4">
      <button type="button" onClick={onCancel} className="rounded-[10px] border border-line px-4 py-2.5 text-sm font-medium text-ink-950">Vazgeç</button>
      <button type="submit" disabled={pending} className={`btn-shine inline-flex items-center gap-2 rounded-[10px] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 ${danger ? "bg-danger-500" : "bg-brand-600"}`}>
        {danger ? <Siren className="h-4 w-4" /> : <Check className="h-4 w-4" />} {pending ? "Kaydediliyor…" : submitLabel}
      </button>
    </div>
  );
}
