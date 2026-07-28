"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Check, Copy, ExternalLink, MessageCircle, Search, Settings2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/components/app/toast-provider";
import { toWhatsAppLink } from "@/lib/phone";
import {
  CATEGORY_BADGE,
  CATEGORY_LABELS,
  TEMPLATE_CATEGORIES,
  renderTemplate,
  type TemplateCategory,
  type TemplateVars,
} from "@/lib/message-templates";
import {
  listMessageTemplates,
  recordTemplateUsage,
  type MessageTemplateRow,
} from "@/app/actions/message-templates";

/** Türkçe duyarlı arama karşılaştırması (İ/ı sorunlarını azaltır). */
function fold(value: string): string {
  return value.toLocaleLowerCase("tr").replace(/[İIı]/g, "i");
}

/**
 * Şablonlu WhatsApp düğmesi.
 *
 * Ofisin `message_templates` kütüphanesinden şablon seçtirir, değişkenleri
 * (müşteri/danışman/portföy/randevu…) doldurur ve wa.me deep-link'ini yeni
 * sekmede açar. Mesajı kullanıcı kendi WhatsApp'ından gönderir — sistem
 * otomatik gönderim yapmaz, bu yüzden İYS/EİDS akışıyla ilgisi yoktur.
 *
 * Şablon listesi dialog ilk açılışta BİR KEZ çekilir (server action), sonraki
 * açılışlarda bellekten okunur.
 */
export function WaTemplateMenu({
  phone,
  vars,
  variant = "hero",
  label = "WhatsApp",
}: {
  phone: string | null | undefined;
  /** Şablon değişken değerleri — verilmeyen alanlar render'da temizlenir. */
  vars: TemplateVars;
  variant?: "hero" | "row";
  label?: string;
}) {
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<MessageTemplateRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MessageTemplateRow | null>(null);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const [loading, startLoad] = useTransition();
  // Aynı dialog oturumunda tekrar tıklanan şablon sayacı şişirmesin
  const counted = useRef<Set<string>>(new Set());

  const plainLink = toWhatsAppLink(phone);
  if (!plainLink) return null;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setSelected(null);
      setQuery("");
      setCopied(false);
      return;
    }
    if (templates === null) {
      startLoad(async () => {
        const res = await listMessageTemplates();
        if (res.error) setLoadError(res.error);
        setTemplates(res.templates);
      });
    }
  }

  function handleSelect(t: MessageTemplateRow) {
    setSelected(t);
    setCopied(false);
    // Fire-and-forget: sayaç mesajdan önemli değil, hata kullanıcıya yansımaz
    if (!counted.current.has(t.id)) {
      counted.current.add(t.id);
      void recordTemplateUsage(t.id);
    }
  }

  const message = selected ? renderTemplate(selected.body, vars) : "";
  const waHref = selected ? (toWhatsAppLink(phone, message) ?? plainLink) : plainLink;

  const filtered = (templates ?? []).filter((t) => {
    if (!query.trim()) return true;
    const q = fold(query.trim());
    return fold(t.title).includes(q) || fold(t.body).includes(q);
  });

  const grouped = TEMPLATE_CATEGORIES.map((cat) => ({
    cat,
    items: filtered.filter((t) => t.category === cat),
  })).filter((g) => g.items.length > 0);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      push("Mesaj panoya kopyalandı", "ok");
    } catch {
      push("Kopyalanamadı — metni elle seçin", "err");
    }
  }

  const trigger =
    variant === "row" ? (
      <button
        type="button"
        aria-label="Şablonla WhatsApp mesajı"
        className="focus-ring press relative z-10 grid h-8 w-8 place-items-center rounded-[9px] text-text-faint transition hover:bg-mint-500/10 hover:text-mint-600"
      >
        <MessageCircle className="h-4 w-4" />
      </button>
    ) : (
      <button
        type="button"
        className="focus-ring press inline-flex items-center gap-1.5 rounded-[10px] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
      >
        <MessageCircle className="h-4 w-4" /> {label}
      </button>
    );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>

      <DialogContent size="md">
        <DialogHeader
          icon={<MessageCircle />}
          title="WhatsApp mesajı"
          description="Şablon seçin — değişkenler otomatik dolar, mesaj kendi WhatsApp'ınızda açılır."
        />

        <div className="space-y-4 p-6">
          {/* Arama */}
          {(templates?.length ?? 0) > 0 ? (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Şablon ara…"
                aria-label="Şablon ara"
                className="focus-ring w-full rounded-[10px] border border-line bg-canvas py-2.5 pl-9 pr-3 text-sm text-ink-950 placeholder:text-text-faint"
              />
            </div>
          ) : null}

          {/* Liste / durumlar */}
          {loading && templates === null ? (
            <p className="py-6 text-center text-sm text-text-muted">Şablonlar yükleniyor…</p>
          ) : loadError ? (
            <p className="rounded-[10px] border border-danger-500/25 bg-danger-500/8 px-3 py-2 text-xs font-semibold text-danger-500">
              {loadError}
            </p>
          ) : (templates?.length ?? 0) === 0 ? (
            <div className="rounded-[12px] border border-line bg-canvas px-4 py-5 text-center">
              <p className="text-sm font-semibold text-ink-950">Şablon tanımlanmamış</p>
              <p className="mt-1 text-xs text-text-muted">
                Ofisinizin standart mesajlarını bir kez tanımlayın, herkes tek tıkla kullansın.
              </p>
              <Link
                href="/app/ayarlar/mesaj-sablonlari"
                className="focus-ring press mt-3 inline-flex items-center gap-1.5 rounded-[10px] border border-line bg-surface px-3.5 py-2 text-xs font-semibold text-brand-600 transition hover:border-brand-300"
              >
                <Settings2 className="h-3.5 w-3.5" /> Ayarlar › Mesaj Şablonları
              </Link>
            </div>
          ) : grouped.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">Aramayla eşleşen şablon yok.</p>
          ) : (
            <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
              {grouped.map((g) => (
                <div key={g.cat}>
                  <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-text-faint">
                    {CATEGORY_LABELS[g.cat]}
                  </p>
                  <ul className="mt-1.5 space-y-1.5">
                    {g.items.map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => handleSelect(t)}
                          aria-pressed={selected?.id === t.id}
                          className={`focus-ring press w-full rounded-[11px] border px-3 py-2.5 text-left transition ${
                            selected?.id === t.id
                              ? "border-brand-300 bg-brand-600/8"
                              : "border-line bg-canvas hover:border-brand-300"
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-950">{t.title}</span>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${CATEGORY_BADGE[t.category as TemplateCategory] ?? CATEGORY_BADGE.genel}`}>
                              {CATEGORY_LABELS[t.category as TemplateCategory] ?? "Genel"}
                            </span>
                          </span>
                          <span className="mt-0.5 line-clamp-1 block text-xs text-text-muted">{t.body}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {/* Önizleme */}
          {selected ? (
            <div className="rounded-[12px] border border-line bg-canvas p-3.5">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-text-faint">Gönderilecek mesaj</p>
              <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-[10px] bg-mint-500/8 px-3 py-2.5 text-sm leading-relaxed text-ink-950">
                {message}
              </p>
            </div>
          ) : null}

          <div className="hairline-t flex flex-wrap justify-end gap-2 pt-4">
            {selected ? (
              <button
                type="button"
                onClick={handleCopy}
                className="focus-ring press inline-flex items-center gap-1.5 rounded-[10px] border border-hairline px-4 py-2 text-sm font-semibold text-text-muted transition hover:bg-canvas"
              >
                {copied ? <Check className="h-4 w-4 text-mint-600" /> : <Copy className="h-4 w-4" />}
                {copied ? "Kopyalandı" : "Metni kopyala"}
              </button>
            ) : null}
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[10px] bg-mint-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-mint-700"
            >
              <ExternalLink className="h-4 w-4" />
              {selected ? "WhatsApp'ta aç" : "Boş mesajla aç"}
            </a>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
