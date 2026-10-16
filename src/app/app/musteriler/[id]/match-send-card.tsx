"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { ArrowUpRight, Copy, EyeOff, MessageCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/app/toast-provider";
import { markMatchChannel, sendMatchToCustomer } from "@/app/actions/matching";
import { toWhatsAppLink, toWhatsAppShareLink } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { buildMultiMatchMessage, type MatchSendItem } from "./match-send-message";

export type MatchSendRow = {
  key: string;
  demandId: string;
  propertyId: string;
  title: string;
  /** "4.500.000 ₺ · ES-2610-…" gibi ikinci satır (kod sona). */
  meta: string;
  listPrice: number | null;
  fit: "Çok uygun" | "Uygun";
  /** Tam görünümde gösterilen uyum (0–100); sade görünümde yalnız etiket. */
  score: number;
  /** Yayında değilse müşteriye gönderilemez (paylaşım sayfası göstermez). */
  sendable: boolean;
  /** Sunucuda çizilen durum rozetleri ("gönderildi · açıldı", "Müşteri beğendi"). */
  badges?: ReactNode;
};

/** İlk açılışta seçili gelen ilan sayısı (plan C14: "ilk 5 seçili"). */
export const MATCH_PRESELECT = 5;

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

/**
 * "Uygun ilanlar (n)" kartı (C14): müşterinin açık taleplerine uyan ilanlar, ilk 5'i seçili; tek büyük düğme seçilenleri
 * TEK WhatsApp iletisiyle gönderir. Her ilan için token'lı paylaşım bağlantısı tekil gönderimle AYNI eylemden gelir
 * (`sendMatchToCustomer`: "gönderildi" kaydı + müşteri geçmişi); ileti müşterinin numarasına hazır açılır.
 */
export function MatchSendCard({
  rows,
  total,
  visible,
  allHref,
  hidden,
  truncated,
  customerName,
  phone,
  advisorName,
  officeName,
  simple,
}: {
  rows: MatchSendRow[];
  /** Tekil ilan sayısı (başlıktaki n). */
  total: number;
  /** Kartta gösterilen en çok satır. */
  visible: number;
  allHref: string;
  hidden: { href: string; count: number } | null;
  truncated: boolean;
  customerName: string;
  phone: string | null;
  advisorName: string | null;
  officeName: string | null;
  simple: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const shown = rows.slice(0, visible);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(shown.filter((r) => r.sendable).slice(0, MATCH_PRESELECT).map((r) => r.key)),
  );
  const [ready, setReady] = useState<{ href: string; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const count = shown.filter((r) => selected.has(r.key)).length;

  function toggle(key: string) {
    setReady(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function send() {
    const picked = shown.filter((r) => selected.has(r.key) && r.sendable);
    if (picked.length === 0 || pending) return;
    setError(null);
    startTransition(async () => {
      const items: MatchSendItem[] = [];
      const sent: MatchSendRow[] = [];
      let lastError: string | null = null;
      for (const r of picked) {
        const res = await sendMatchToCustomer(fd({ demand_id: r.demandId, property_id: r.propertyId }));
        if ("error" in res) {
          lastError = res.error;
          continue;
        }
        items.push({ title: r.title, listPrice: r.listPrice, url: res.url });
        sent.push(r);
      }
      if (items.length === 0) {
        setError(lastError ?? "İlanlar hazırlanamadı.");
        return;
      }
      const message = buildMultiMatchMessage({ customerName, items, advisorName, officeName });
      const href = toWhatsAppLink(phone, message) ?? toWhatsAppShareLink(message);
      if (!href) {
        setError("WhatsApp bağlantısı oluşturulamadı.");
        return;
      }
      for (const r of sent) void markMatchChannel(fd({ demand_id: r.demandId, property_id: r.propertyId, channel: "whatsapp" }));
      if (lastError) toast.push(`${picked.length - sent.length} ilan gönderilemedi: ${lastError}`, "err");
      // Kullanıcı dokunuşunun hemen ardından WhatsApp açılır; tarayıcı engellerse büyük "WhatsApp'ı aç" düğmesi kalır.
      const win = window.open(href, "_blank", "noopener,noreferrer");
      setReady({ href, message });
      if (win) toast.push(`${sent.length} ilan WhatsApp'a hazırlandı.`, "ok");
      router.refresh();
    });
  }

  async function copy() {
    if (!ready) return;
    try {
      await navigator.clipboard.writeText(ready.message);
      toast.push("İleti kopyalandı.", "ok");
    } catch {
      toast.push("Kopyalanamadı.", "err");
    }
  }

  const sendLabel = count === 1 ? "İlanı WhatsApp'tan gönder" : `${count} ilanı WhatsApp'tan gönder`;

  return (
    <section
      id="uygun-ilanlar"
      aria-labelledby="uygun-ilanlar-baslik"
      className="scroll-mt-24 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-xs)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
        <h2 id="uygun-ilanlar-baslik" className="flex items-center gap-2 font-display text-lg font-bold text-ink-950">
          <Sparkles className="h-4 w-4 text-brand-600" aria-hidden /> Uygun ilanlar ({total})
        </h2>
        <Link
          href={allHref}
          className="focus-ring inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-control)] px-2 text-sm font-semibold text-brand-700 hover:underline"
        >
          Tümünü gör <ArrowUpRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>

      {shown.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-text-muted">Şu an gösterilecek yeni ilan yok.</p>
      ) : (
        <ul className="divide-y divide-line" aria-label="Gönderilecek ilanları seçin">
          {shown.map((r) => {
            const on = selected.has(r.key);
            return (
              <li key={r.key} className="flex items-stretch">
                <label
                  className={cn(
                    "flex min-h-14 min-w-0 flex-1 cursor-pointer items-center gap-3 px-4 py-2.5 sm:px-5",
                    !r.sendable && "cursor-not-allowed opacity-70",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!r.sendable || pending}
                    onChange={() => toggle(r.key)}
                    className="h-5 w-5 shrink-0 rounded border-line accent-brand-600"
                    aria-label={`${r.title} gönderilecekler arasında`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-ink-950">{r.title}</span>
                    <span className="block truncate text-sm text-text-muted">
                      {r.sendable ? r.meta : `${r.meta ? `${r.meta} · ` : ""}yayında değil`}
                    </span>
                    {r.badges ? <span className="mt-1 flex flex-wrap gap-1">{r.badges}</span> : null}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2.5 py-1 text-xs font-bold",
                      r.fit === "Çok uygun" ? "bg-mint-500/12 text-mint-700" : "bg-brand-600/10 text-brand-700",
                    )}
                  >
                    {r.fit}
                    {simple ? null : <span className="ml-1 font-semibold opacity-75">· uyum {r.score}/100</span>}
                  </span>
                </label>
                <Link
                  href={`/app/portfoyler/${r.propertyId}`}
                  aria-label={`${r.title} ilanını aç`}
                  className="focus-ring grid min-h-11 w-12 shrink-0 place-items-center text-text-faint hover:text-brand-600"
                >
                  <ArrowUpRight className="h-4 w-4" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {shown.length > 0 ? (
        <div className="space-y-2 border-t border-line px-4 py-3 sm:px-5">
          {ready ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <a
                href={ready.href}
                target="_blank"
                rel="noopener noreferrer"
                className="focus-ring press inline-flex min-h-12 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-mint-600 px-4 text-base font-semibold text-white hover:bg-mint-700"
              >
                <MessageCircle className="h-5 w-5" aria-hidden /> WhatsApp&apos;ı aç
              </a>
              <Button type="button" variant="outline" icon={Copy} onClick={copy} className="min-h-12">
                İletiyi kopyala
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              icon={MessageCircle}
              loading={pending}
              disabled={count === 0}
              onClick={send}
              className="min-h-12 w-full text-base"
            >
              {pending ? "Hazırlanıyor…" : count === 0 ? "Göndermek için ilan seçin" : sendLabel}
            </Button>
          )}
          {error ? (
            <p role="alert" className="text-sm font-medium text-danger-600">
              {error}
            </p>
          ) : null}
          {rows.length > visible || hidden || truncated ? (
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-muted">
              {rows.length > visible ? (
                <Link href={allHref} className="focus-ring inline-flex min-h-11 items-center font-semibold text-brand-700 hover:underline">
                  +{rows.length - visible} ilan daha
                </Link>
              ) : null}
              {hidden ? (
                <Link href={hidden.href} className="focus-ring inline-flex min-h-11 items-center gap-1 font-semibold hover:text-brand-600">
                  <EyeOff className="h-4 w-4" aria-hidden /> {hidden.count} gizlenen ilan
                </Link>
              ) : null}
              {truncated && !simple ? <span>Yalnız en yeni ilanlar tarandı.</span> : null}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
