"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Combobox } from "@/components/ui/combobox";
import { searchProperties } from "@/app/actions/lookup";
import {
  Check,
  Link2,
  Plus,
  RadioTower,
  Siren,
} from "lucide-react";
import {
  closePortalListing,
  createPortalListing,
} from "@/app/actions/portal-listings";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
} from "@/components/ui/dialog";

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
      <DialogShell open={open} onOpenChange={setOpen} title="Portal ilanı bağla" description="Portföyü yayın ağına ekleyin." icon={RadioTower}>
          <form ref={formRef} action={submit} className="grid gap-4 p-4 md:p-6">
            <div className="text-sm font-medium text-ink-950">
              Portföy *
              {/* Zorunlu alan: temizleme düğmesi kapalı (`required`),
                  boş bırakılırsa gizli input `required` ile submit'i durdurur. */}
              <Combobox
                className="mt-1.5"
                name="property_id"
                required
                aria-label="Portföy"
                placeholder="Portföy seçin"
                searchPlaceholder="Kod ya da başlık ara…"
                emptyText="Eşleşen portföy yok"
                onSearch={searchProperties}
                options={properties.map((property) => ({
                  value: property.id,
                  label: property.title ?? "İsimsiz portföy",
                  hint: property.property_code,
                }))}
              />
            </div>
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
            <DialogActions pending={pending} submitLabel="Yayın ağına ekle" />
          </form>
      </DialogShell>
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
      <DialogShell open={open} onOpenChange={setOpen} title="İlan kapanış formu" description={label} icon={Siren} danger>
          <form action={submit} className="grid gap-4 p-4 md:p-6">
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
            <DialogActions pending={pending} submitLabel="Kapanışı kaydet" danger />
          </form>
      </DialogShell>
    </>
  );
}

/**
 * Ortak dialog kabuğu — Radix Dialog üzerine.
 *
 * Tek yerde taşındığı için bu dosyadaki İKİ dialog da birden kazanıyor:
 * focus trap, Esc ile kapatma (öncesinde YOKTU), scroll lock, aria-modal +
 * başlık/açıklama ilişkisi, kapanışta focus'un tetikleyiciye dönmesi.
 */
function DialogShell({
  open,
  onOpenChange,
  title,
  description,
  icon: Icon,
  danger = false,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  icon: typeof RadioTower;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader
          icon={<Icon />}
          title={title}
          description={description}
          tone={danger ? "danger" : "default"}
        />
        {children}
      </DialogContent>
    </Dialog>
  );
}

function DialogActions({
  pending,
  submitLabel,
  danger = false,
}: {
  pending: boolean;
  submitLabel: string;
  danger?: boolean;
}) {
  return (
    <div className="hairline-t flex justify-end gap-2 pt-4">
      <DialogClose asChild>
        <button type="button" className="focus-ring press rounded-[10px] border border-hairline px-4 py-2.5 text-sm font-medium text-ink-950 transition hover:bg-canvas">
          Vazgeç
        </button>
      </DialogClose>
      <button type="submit" disabled={pending} className={`btn-shine focus-ring press inline-flex items-center gap-2 rounded-[10px] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 ${danger ? "bg-danger-600" : "bg-brand-600"}`}>
        {danger ? <Siren className="h-4 w-4" /> : <Check className="h-4 w-4" />} {pending ? "Kaydediliyor…" : submitLabel}
      </button>
    </div>
  );
}
