"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, Copy, ExternalLink, Plus, Presentation, Search } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { createPresentation } from "@/app/actions/presentations";

export type SelectableProperty = {
  id: string;
  code: string;
  title: string | null;
  price: number | null;
  tx: string;
  district: string | null;
};

// Action tarafındaki MAX_PRESENTATION_PROPERTIES ile aynı — sunum 5 slaytı geçmesin.
const MAX_SELECT = 5;

function money(n: number | null, tx: string) {
  if (n == null) return "Fiyat girilmedi";
  const s = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
  return tx === "rent" || tx === "Kiralık" ? `${s}/ay` : s;
}

/** Türkçe katlamalı arama — foldTr'nin hafif client kopyası (İ/ı/ş… duyarsız). */
function fold(s: string) {
  return s
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ı", "i")
    .replaceAll("ş", "s")
    .replaceAll("ğ", "g")
    .replaceAll("ü", "u")
    .replaceAll("ö", "o")
    .replaceAll("ç", "c");
}

/**
 * Yeni sunum sihirbazı: başlık + müşteri adı + not + yayındaki portföylerden
 * aramalı çoklu seçim (maks 5). Başarıda dialog kapanmaz — üretilen public
 * link kopyalanabilir halde gösterilir (danışman linki hemen WhatsApp'a taşır).
 */
export function NewPresentationDialog({
  properties,
  preselectedId,
}: {
  properties: SelectableProperty[];
  preselectedId?: string | null;
}) {
  // Ön seçim yalnız gerçekten seçilebilir (yayında) bir portföyse uygulanır.
  const validPreselect = preselectedId && properties.some((p) => p.id === preselectedId) ? [preselectedId] : [];
  const [open, setOpen] = useState(Boolean(validPreselect.length));
  const [selected, setSelected] = useState<string[]>(validPreselect);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const needle = fold(query.trim());
    if (!needle) return properties;
    return properties.filter((p) =>
      fold(`${p.code} ${p.title ?? ""} ${p.district ?? ""}`).includes(needle),
    );
  }, [properties, query]);

  const toggle = (id: string) => {
    setError(null);
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_SELECT) return prev; // sınır dolu — sessizce yoksay, sayaç zaten kırmızı
      return [...prev, id];
    });
  };

  const reset = () => {
    setSelected(validPreselect);
    setQuery("");
    setError(null);
    setCreatedUrl(null);
    setCopied(false);
  };

  const submit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const result = await createPresentation(formData);
      if (result.error) setError(result.error);
      else if (result.url) setCreatedUrl(result.url);
    });
  };

  const copy = async () => {
    if (!createdUrl) return;
    try {
      await navigator.clipboard.writeText(createdUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Panoya kopyalanamadı — linki elle seçip kopyalayın.");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" /> Yeni sunum
        </Button>
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader
          icon={<Presentation />}
          title="Yeni portföy sunumu"
          description="Müşteriniz için 1-5 portföylük şık bir sunum linki üretin."
        />
        {createdUrl ? (
          <>
            <DialogBody>
              <div className="rounded-[16px] border border-mint-500/30 bg-mint-500/5 p-5 text-center">
                <span className="mx-auto grid h-11 w-11 place-items-center rounded-[13px] bg-mint-500/15 text-mint-600">
                  <Check className="h-5 w-5" />
                </span>
                <p className="mt-3 font-display text-base font-bold text-ink-950">Sunum hazır</p>
                <p className="mt-1 text-xs text-text-muted">
                  Linki kopyalayıp WhatsApp&apos;tan gönderin — müşteri telefonda sunum gibi gezer,
                  yazdırınca A4 dosya olur.
                </p>
                <p className="numeric mt-3 select-all break-all rounded-[10px] border border-line bg-canvas px-3 py-2 text-xs text-ink-950">
                  {createdUrl}
                </p>
                <div className="mt-3 flex justify-center gap-2">
                  <Button variant="secondary" size="sm" onClick={copy}>
                    {copied ? <Check className="h-3.5 w-3.5 text-mint-600" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? "Kopyalandı" : "Linki kopyala"}
                  </Button>
                  <a
                    href={createdUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="focus-ring press inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-hairline-strong bg-surface px-3 text-xs font-semibold text-ink-950 hover:bg-canvas"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Önizle
                  </a>
                </div>
              </div>
              {error ? <p className="mt-3 text-sm font-semibold text-danger-500">{error}</p> : null}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={reset}>Yeni sunum daha</Button>
              <DialogClose asChild>
                <Button variant="secondary">Kapat</Button>
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <form action={submit}>
            {selected.map((id) => (
              <input key={id} type="hidden" name="property_ids" value={id} />
            ))}
            <DialogBody className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-semibold text-text-muted">Sunum başlığı *</span>
                  <input
                    name="title"
                    required
                    maxLength={120}
                    placeholder="Örn. Kadıköy 3+1 seçkisi"
                    className="mt-1 w-full rounded-[11px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-text-muted">Müşteri adı</span>
                  <input
                    name="customer_name"
                    maxLength={120}
                    placeholder="Örn. Ayşe Yılmaz"
                    className="mt-1 w-full rounded-[11px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface"
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-semibold text-text-muted">Not (sunumun kapağında görünür)</span>
                <textarea
                  name="note"
                  rows={2}
                  maxLength={500}
                  placeholder="Örn. Görüşmemizde konuştuğumuz kriterlere uyan portföyleri sizin için derledim."
                  className="mt-1 w-full resize-none rounded-[11px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface"
                />
              </label>

              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-text-muted">Portföyler (yayında olanlar)</span>
                  <span
                    className={`text-xs font-bold ${selected.length >= MAX_SELECT ? "text-danger-500" : "text-brand-600"}`}
                  >
                    {selected.length}/{MAX_SELECT} seçili
                  </span>
                </div>
                <div className="relative mt-1.5">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Portföy ara"
                    placeholder="Kod, başlık veya ilçe ara…"
                    className="w-full rounded-[11px] border border-line bg-canvas py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-brand-400 focus:bg-surface"
                  />
                </div>
                <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-[12px] border border-line bg-canvas p-1.5">
                  {properties.length === 0 ? (
                    <p className="px-3 py-6 text-center text-sm text-text-muted">
                      Yayında portföy yok — sunuma eklemek için önce bir portföyü yayına alın.
                    </p>
                  ) : filtered.length === 0 ? (
                    <p className="px-3 py-6 text-center text-sm text-text-muted">Aramanıza uyan portföy yok.</p>
                  ) : (
                    filtered.map((p) => {
                      const checked = selected.includes(p.id);
                      const full = !checked && selected.length >= MAX_SELECT;
                      return (
                        <label
                          key={p.id}
                          className={`flex cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 transition ${
                            checked ? "bg-brand-600/8 ring-1 ring-brand-300/60" : "hover:bg-surface"
                          } ${full ? "cursor-not-allowed opacity-45" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={full}
                            onChange={() => toggle(p.id)}
                            className="h-4 w-4 shrink-0 accent-[#1463FF]"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-ink-950">
                              {p.title ?? p.code}
                            </span>
                            <span className="block text-[11px] text-text-muted">
                              {p.code}
                              {p.district ? ` · ${p.district}` : ""} · {money(p.price, p.tx)}
                            </span>
                          </span>
                          {checked ? <Check className="h-4 w-4 shrink-0 text-brand-600" /> : null}
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              {error ? <p className="text-sm font-semibold text-danger-500">{error}</p> : null}
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="secondary">Vazgeç</Button>
              </DialogClose>
              <Button type="submit" loading={pending} disabled={selected.length === 0}>
                Sunumu oluştur
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
