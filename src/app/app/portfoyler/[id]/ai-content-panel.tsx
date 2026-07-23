"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Mail, MessageCircle, Share2, Sparkles, Wand2 } from "lucide-react";
import { generatePropertyContent } from "@/app/actions/ai-content";
import type { ContentKind } from "@/lib/ai/content";

const TABS: { key: ContentKind; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "listing", label: "İlan açıklaması", icon: Sparkles },
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { key: "social", label: "Sosyal medya", icon: Share2 },
  { key: "email", label: "E-posta", icon: Mail },
];

export function AiContentPanel({ propertyId }: { propertyId: string }) {
  const [tab, setTab] = useState<ContentKind>("listing");
  const [text, setText] = useState("");
  const [source, setSource] = useState<"ai" | "template" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(kind: ContentKind) {
    setTab(kind);
    setError(null);
    startTransition(async () => {
      const res = await generatePropertyContent(propertyId, kind);
      if (res.error) {
        setError(res.error);
        setText("");
        setSource(null);
        return;
      }
      setText(res.text ?? "");
      setSource(res.source ?? null);
    });
  }

  return (
    <section className="overflow-hidden rounded-[20px] border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <Wand2 className="h-4 w-4 text-violet-600" /> AI içerik motoru
          </h2>
          <p className="text-xs text-text-muted">İlan, WhatsApp, sosyal medya ve e-posta metnini tek tıkla üret.</p>
        </div>
        {source ? (
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${source === "ai" ? "bg-violet-500/12 text-violet-600" : "bg-ink-950/8 text-text-muted"}`}>
            {source === "ai" ? "AI üretti" : "Akıllı şablon"}
          </span>
        ) : null}
      </div>

      <div className="p-5">
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => run(t.key)}
              disabled={pending}
              className={`inline-flex items-center gap-1.5 rounded-[10px] border px-3 py-2 text-xs font-semibold transition disabled:opacity-60 ${
                tab === t.key ? "border-violet-400/50 bg-violet-500/10 text-violet-700" : "border-line bg-canvas text-ink-950 hover:border-brand-300"
              }`}
            >
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          ))}
        </div>

        {error ? <p className="mt-3 text-sm font-medium text-danger-500">{error}</p> : null}

        {pending ? (
          <p className="mt-4 text-sm text-text-muted">İçerik üretiliyor…</p>
        ) : text ? (
          <div className="mt-4">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              className="w-full rounded-[12px] border border-line bg-canvas p-4 text-sm leading-relaxed text-ink-950 outline-none focus:border-violet-400"
            />
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="mt-3 inline-flex items-center gap-1.5 rounded-[10px] bg-ink-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink-800"
            >
              {copied ? <Check className="h-4 w-4 text-mint-400" /> : <Copy className="h-4 w-4" />}
              {copied ? "Kopyalandı" : "Kopyala"}
            </button>
          </div>
        ) : (
          <p className="mt-4 rounded-[12px] border border-dashed border-line bg-canvas/50 px-4 py-8 text-center text-sm text-text-muted">
            Bir içerik türü seçin, portföy bilgilerinden otomatik metin üretelim.
          </p>
        )}
      </div>
    </section>
  );
}
