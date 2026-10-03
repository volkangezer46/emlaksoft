"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, Copy, ExternalLink, Search, UserRound, X } from "lucide-react";
import { TAB_ICONS as TI } from "@/lib/icons";
import { Button, ButtonLink } from "@/components/ui/button";
import { FormActions, FormPage } from "@/components/ui/form-page";
import { SummaryGroup, SummaryRow, TabbedFormShell, type FormTab, type TabbedSummaryContext } from "@/components/ui/tabbed-form-shell";
import { useToast } from "@/components/app/toast-provider";
import { createPresentation } from "@/app/actions/presentations";
import { PRESENTATION_TABS } from "./presentation-tabs";

export type SelectableProperty = {
  id: string;
  code: string;
  title: string | null;
  price: number | null;
  tx: string;
  district: string | null;
};

export type SelectableCustomer = {
  id: string;
  name: string;
  phone: string | null;
};

// Action tarafındaki MAX_PRESENTATION_PROPERTIES ile aynı — sunum 5 slaytı geçmesin.
const MAX_SELECT = 5;
// Müşteri arama önerisi: liste değil, kısa vurgu — 6 satır ekranı boğmaz.
const CUSTOMER_SUGGESTIONS = 6;

const LIST_HREF = "/app/portfoyler/sunumlar";

const TAB_ICONS = { bilgi: TI.sunumBilgi, portfoyler: TI.portfoyler } as const;
const TABS: FormTab[] = PRESENTATION_TABS.map((t) => ({
  id: t.id,
  label: t.label,
  description: t.description,
  icon: TAB_ICONS[t.id],
  fields: [...t.fields],
  required: [...t.required],
}));
const FIELD_LABELS = { title: "Sunum başlığı", property_ids: "Portföy seçimi" };

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
 * Yeni sunum formu: başlık + müşteri adı + not + yayındaki portföylerden
 * aramalı çoklu seçim (maks 5). Başarıda sayfa değişmez — üretilen public
 * link kopyalanabilir halde gösterilir (danışman linki hemen WhatsApp'a taşır).
 */
export function PresentationForm({
  properties,
  customers = [],
  preselectedId,
  preselectedCustomerId,
}: {
  properties: SelectableProperty[];
  customers?: SelectableCustomer[];
  preselectedId?: string | null;
  /** ?musteri= — eşleştirme ekranındaki "Sunum hazırla" müşteriyi de taşır. */
  preselectedCustomerId?: string | null;
}) {
  const { push } = useToast();
  // Ön seçim yalnız gerçekten seçilebilir (yayında) bir portföyse uygulanır.
  const validPreselect = preselectedId && properties.some((p) => p.id === preselectedId) ? [preselectedId] : [];
  // Müşteri ön seçimi: yalnız listede gerçekten bulunan kayıt bağlanır.
  const presetCustomer = preselectedCustomerId
    ? customers.find((c) => c.id === preselectedCustomerId) ?? null
    : null;
  const [selected, setSelected] = useState<string[]>(validPreselect);
  const [query, setQuery] = useState("");
  /*
   * Müşteri alanı TEK input: yazılan metin hem serbest `customer_name` hem de
   * kayıtlı müşteri araması. Bir öneri seçilirse `pickedCustomer` dolar ve
   * gizli `customer_id` gönderilir; seçilmezse alan düz metindir.
   */
  const [customerQuery, setCustomerQuery] = useState(presetCustomer?.name ?? "");
  const [pickedCustomer, setPickedCustomer] = useState<SelectableCustomer | null>(presetCustomer);
  const [customerFocused, setCustomerFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const needle = fold(query.trim());
    if (!needle) return properties;
    return properties.filter((p) =>
      fold(`${p.code} ${p.title ?? ""} ${p.district ?? ""}`).includes(needle),
    );
  }, [properties, query]);

  const customerMatches = useMemo(() => {
    const needle = fold(customerQuery.trim());
    if (!needle || customers.length === 0) return [];
    return customers
      .filter((c) => fold(`${c.name} ${c.phone ?? ""}`).includes(needle))
      .slice(0, CUSTOMER_SUGGESTIONS);
  }, [customers, customerQuery]);

  const showSuggestions = customerFocused && !pickedCustomer && customerMatches.length > 0;

  const toggle = (id: string) => {
    setError(null);
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_SELECT) return prev; // sınır dolu — sayaç zaten kırmızı
      return [...prev, id];
    });
  };

  const reset = () => {
    setSelected([]);
    setQuery("");
    setCustomerQuery("");
    setPickedCustomer(null);
    setCustomerFocused(false);
    setError(null);
    setCreatedUrl(null);
    setCopied(false);
    setFormKey((k) => k + 1);
  };

  const submit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const result = await createPresentation(formData);
      if (result.error) setError(result.error);
      else if (result.url) {
        setCreatedUrl(result.url);
        push("Sunum oluşturuldu", "ok");
      }
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

  const breadcrumbs = [
    { label: "Portföyler", href: "/app/portfoyler" },
    { label: "Sunumlar", href: LIST_HREF },
    { label: "Yeni" },
  ];

  if (createdUrl) {
    return (
      <FormPage title="Sunum hazır" description="Müşteriniz için sunum linki oluşturuldu." breadcrumbs={breadcrumbs}>
        <section className="rounded-[var(--radius-card)] border border-mint-500/30 bg-mint-500/5 p-5 text-center">
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-mint-500/15 text-mint-600">
            <Check className="h-5 w-5" />
          </span>
          <p className="mt-3 font-display text-base font-bold text-ink-950">Sunum hazır</p>
          <p className="mt-1 text-xs text-text-muted">
            Linki kopyalayıp WhatsApp&apos;tan gönderin — müşteri telefonda sunum gibi gezer,
            yazdırınca A4 dosya olur.
          </p>
          <p className="numeric mt-3 select-all break-all rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-xs text-ink-950">
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
              className="focus-ring press inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-hairline-strong bg-surface px-3 text-xs font-semibold text-ink-950 hover:bg-canvas"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Önizle
            </a>
          </div>
          {error ? <p className="mt-3 text-sm font-semibold text-danger-600" role="alert">{error}</p> : null}
        </section>
        <FormActions>
          <Button variant="ghost" onClick={reset}>Yeni sunum daha</Button>
          <ButtonLink href={LIST_HREF} variant="secondary">Sunumlara dön</ButtonLink>
        </FormActions>
      </FormPage>
    );
  }


  const tabPanels = {
    bilgi: (
      <>
        <label className="block">
          <span className="text-xs font-semibold text-text-muted">Sunum başlığı *</span>
          <input
            name="title"
            required
            maxLength={120}
            placeholder="Örn. Kadıköy 3+1 seçkisi"
            className="mt-1 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface"
          />
        </label>
        {/* Müşteri alanı: yazarken kayıtlı müşteriler önerilir; öneri seçilirse sunum Müşteri 360'ta görünür (customer_id). */}
        <div className="relative">
          <label className="block">
            <span className="text-xs font-semibold text-text-muted">
              Müşteri adı <span className="font-medium text-text-faint">(kayıtlıysa seçin)</span>
            </span>
            <input
              name="customer_name"
              autoComplete="off"
              value={customerQuery}
              onChange={(e) => {
                setCustomerQuery(e.target.value);
                // Ad elle değiştirildiyse bağ düşer — sessiz yanlış eşleşme olmasın.
                if (pickedCustomer && e.target.value !== pickedCustomer.name) {
                  setPickedCustomer(null);
                }
              }}
              onFocus={() => setCustomerFocused(true)}
              // blur'da hemen kapatmak öneriye tıklamayı yutar → küçük gecikme
              onBlur={() => setTimeout(() => setCustomerFocused(false), 150)}
              maxLength={120}
              placeholder="Örn. Ayşe Yılmaz"
              className={`mt-1 w-full rounded-[var(--radius-control)] border bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface ${
                pickedCustomer ? "border-mint-500/50 pr-9" : "border-line"
              }`}
            />
          </label>
          {pickedCustomer ? (
            <>
              <input type="hidden" name="customer_id" value={pickedCustomer.id} />
              <button
                type="button"
                onClick={() => {
                  setPickedCustomer(null);
                  setCustomerQuery("");
                }}
                title="Müşteri bağını kaldır"
                aria-label="Müşteri bağını kaldır"
                className="focus-ring absolute right-2 top-[30px] grid h-7 w-7 place-items-center rounded-[var(--radius-control)] text-text-faint transition hover:bg-canvas hover:text-ink-950"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-mint-600">
                <Check className="h-3 w-3" /> Müşteri kartına bağlanacak
              </p>
            </>
          ) : null}
          {showSuggestions ? (
            <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-lg)]">
              {customerMatches.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setPickedCustomer(c);
                      setCustomerQuery(c.name);
                      setCustomerFocused(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-canvas"
                  >
                    <UserRound className="h-3.5 w-3.5 shrink-0 text-brand-600" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-950">{c.name}</span>
                    {c.phone ? <span className="numeric shrink-0 text-xs text-text-faint">{c.phone}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <label className="block sm:col-span-2">
          <span className="text-xs font-semibold text-text-muted">Not (sunumun kapağında görünür)</span>
          <textarea
            name="note"
            rows={3}
            maxLength={500}
            placeholder="Örn. Görüşmemizde konuştuğumuz kriterlere uyan portföyleri sizin için derledim."
            className="mt-1 w-full resize-none rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface"
          />
        </label>
      </>
    ),
    portfoyler: (
      <div className="sm:col-span-2">
        {selected.map((id) => (
          <input key={id} type="hidden" name="property_ids" value={id} />
        ))}
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-text-muted">Portföyler (yayında olanlar)</span>
          <span className={`text-xs font-bold ${selected.length >= MAX_SELECT ? "text-danger-600" : "text-brand-600"}`}>
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
            className="w-full rounded-[var(--radius-control)] border border-line bg-canvas py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-brand-400 focus:bg-surface"
          />
        </div>
        <div className="mt-2 max-h-96 space-y-1 overflow-y-auto rounded-[var(--radius-card)] border border-line bg-canvas p-1.5">
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
                  className={`flex cursor-pointer items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 transition ${
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
                    <span className="block truncate text-sm font-semibold text-ink-950">{p.title ?? p.code}</span>
                    <span className="block text-xs text-text-muted">
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
    ),
  };

  function renderSummary({ values }: TabbedSummaryContext) {
    const title = (values.title ?? "").trim();
    const customerName = (values.customer_name ?? "").trim();
    const note = (values.note ?? "").trim();
    const chosen = selected
      .map((id) => properties.find((p) => p.id === id))
      .filter((p): p is SelectableProperty => Boolean(p));
    return (
      <>
        <div className="rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3">
          <p className="truncate text-sm font-semibold text-ink-950">{title || "Başlık girilmedi"}</p>
          <p className="mt-0.5 truncate text-xs text-text-muted">
            {customerName ? `Hazırlanan: ${customerName}` : "Müşteri adı girilmedi"}
          </p>
          <p className="numeric mt-1.5 text-xs font-semibold text-brand-600">
            {selected.length}/{MAX_SELECT} portföy seçili
          </p>
        </div>
        <SummaryGroup title="Sunum bilgisi">
          <SummaryRow label="Başlık" value={title || "Zorunlu"} muted={!title} tab="bilgi" field="title" />
          <SummaryRow
            label="Müşteri"
            value={pickedCustomer ? "Müşteri kartına bağlı" : customerName ? "Serbest ad" : "Girilmedi"}
            muted={!customerName}
            tab="bilgi"
            field="customer_name"
          />
          <SummaryRow label="Kapak notu" value={note ? "Girildi" : "Yok"} muted={!note} tab="bilgi" field="note" />
        </SummaryGroup>
        <SummaryGroup title="Seçilen portföyler">
          {chosen.length === 0 ? (
            <SummaryRow label="Portföy" value="Zorunlu (en az 1)" muted tab="portfoyler" />
          ) : (
            chosen.map((p) => (
              <SummaryRow key={p.id} label={p.code} value={p.title ?? money(p.price, p.tx)} tab="portfoyler" />
            ))
          )}
        </SummaryGroup>
      </>
    );
  }

  return (
    <TabbedFormShell
      key={formKey}
      title="Yeni portföy sunumu"
      description="Müşteriniz için 1-5 portföylük şık bir sunum linki üretin."
      breadcrumbs={breadcrumbs}
      cancelHref={LIST_HREF}
      submitLabel="Sunumu oluştur"
      pendingLabel="Oluşturuluyor…"
      submitDisabled={selected.length === 0}
      pending={pending}
      error={error}
      // Sunucu action'ı FormData ile çağrılır; başarıda sayfa değişmez, link kartı gösterilir.
      onSubmit={(e) => {
        e.preventDefault();
        submit(new FormData(e.currentTarget));
      }}
      tabs={TABS}
      tabPanels={tabPanels}
      summary={renderSummary}
      fieldLabels={FIELD_LABELS}
    />
  );
}
