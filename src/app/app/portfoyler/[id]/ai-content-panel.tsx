"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Languages, Mail, MessageCircle, Share2, Sparkles, Wand2 } from "lucide-react";
import { generatePropertyContent, savePropertyDescription, translatePropertyContent } from "@/app/actions/ai-content";
import { useToast } from "@/components/app/toast-provider";
import type { ContentKind } from "@/lib/ai/content";
import { TRANSLATE_LANGS, TRANSLATION_LABEL, TRANSLATION_NOTICE, type TranslateLang } from "@/lib/ai/translate-logic";

const TABS: { key: ContentKind; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "listing", label: "İlan açıklaması", icon: Sparkles },
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { key: "social", label: "Sosyal medya", icon: Share2 },
  { key: "email", label: "E-posta", icon: Mail },
];

export function AiContentPanel({ propertyId, canEdit = false }: { propertyId: string; canEdit?: boolean }) {
  const [tab, setTab] = useState<ContentKind>("listing");
  const [text, setText] = useState("");
  const [source, setSource] = useState<"ai" | "template" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const [saving, startSave] = useTransition();
  const { push } = useToast();
  // Çeviri: yalnız taslak; hiçbir kayda yazılmaz (kopyalanır).
  const [lang, setLang] = useState<TranslateLang | null>(null);
  const [translated, setTranslated] = useState("");
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [translating, startTranslate] = useTransition();
  const [copiedTr, setCopiedTr] = useState(false);

  function translate(target: TranslateLang) {
    setLang(target);
    setTranslateError(null);
    startTranslate(async () => {
      const res = await translatePropertyContent(propertyId, text, target);
      if (res.error) {
        setTranslateError(res.error);
        setTranslated("");
        return;
      }
      setTranslated(res.text ?? "");
    });
  }

  // Tek akış: metin düzenleme panelindeki "Açıklama" alanıyla aynı depoya (features.description) yazılır.
  function saveAsDescription() {
    startSave(async () => {
      const res = await savePropertyDescription(propertyId, text);
      if (res.error) push(res.error, "err");
      else push("Portföy açıklaması güncellendi", "ok");
    });
  }

  function run(kind: ContentKind) {
    setTab(kind);
    setError(null);
    setLang(null);
    setTranslated("");
    setTranslateError(null);
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
    <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <Wand2 className="h-4 w-4 text-cyan-600" /> AI içerik motoru
          </h2>
          <p className="text-xs text-text-muted">İlan, WhatsApp, sosyal medya ve e-posta metnini tek tıkla üret.</p>
        </div>
        {source ? (
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${source === "ai" ? "bg-cyan-400/12 text-cyan-600" : "bg-ink-950/8 text-text-muted"}`}>
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
              className={`inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border px-3 py-2 text-xs font-semibold transition disabled:opacity-60 ${
                tab === t.key ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-700" : "border-line bg-canvas text-ink-950 hover:border-brand-300"
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
              aria-label="Üretilen metin"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              className="w-full rounded-[var(--radius-card)] border border-line bg-canvas p-4 text-sm leading-relaxed text-ink-950 outline-none focus:border-cyan-400"
            />
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-ink-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink-800"
            >
              {copied ? <Check className="h-4 w-4 text-mint-400" /> : <Copy className="h-4 w-4" />}
              {copied ? "Kopyalandı" : "Kopyala"}
            </button>
            {tab === "listing" && canEdit ? (
              <button
                type="button"
                onClick={saveAsDescription}
                disabled={saving || !text.trim()}
                className="ml-2 mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-cyan-400/50 bg-cyan-400/10 px-4 py-2.5 text-sm font-semibold text-cyan-700 hover:bg-cyan-400/15 disabled:opacity-60"
              >
                {saving ? "Kaydediliyor…" : "Portföy açıklamasına kaydet"}
              </button>
            ) : null}
            <div className="mt-5 border-t border-line pt-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
                <Languages className="h-3.5 w-3.5" aria-hidden /> Yabancı alıcılar için çevir
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {TRANSLATE_LANGS.map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => translate(l.code)}
                    disabled={translating || pending || !text.trim()}
                    aria-pressed={lang === l.code}
                    className={`rounded-[var(--radius-control)] border px-3 py-2 text-xs font-semibold transition disabled:opacity-60 ${
                      lang === l.code ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-700" : "border-line bg-canvas text-ink-950 hover:border-brand-300"
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              {translateError ? <p className="mt-2 text-sm font-medium text-danger-500">{translateError}</p> : null}
              {translating ? (
                <p className="mt-3 text-sm text-text-muted">Çevriliyor…</p>
              ) : translated ? (
                <div className="mt-3">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-cyan-400/12 px-2.5 py-1 text-xs font-bold text-cyan-700">{TRANSLATION_LABEL}</span>
                    <span className="text-xs text-text-muted">{TRANSLATION_NOTICE}</span>
                  </div>
                  <textarea
                    value={translated}
                    onChange={(e) => setTranslated(e.target.value)}
                    rows={8}
                    dir={lang === "ar" ? "rtl" : "ltr"}
                    lang={lang ?? undefined}
                    aria-label={`${TRANSLATION_LABEL} (düzenlenebilir taslak)`}
                    className="w-full rounded-[var(--radius-card)] border border-line bg-canvas p-4 text-sm leading-relaxed text-ink-950 outline-none focus:border-cyan-400"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(translated);
                      setCopiedTr(true);
                      setTimeout(() => setCopiedTr(false), 1500);
                    }}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-ink-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink-800"
                  >
                    {copiedTr ? <Check className="h-4 w-4 text-mint-400" /> : <Copy className="h-4 w-4" />}
                    {copiedTr ? "Kopyalandı" : "Çeviriyi kopyala"}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="mt-4 rounded-[var(--radius-card)] border border-dashed border-line bg-canvas/50 px-4 py-8 text-center text-sm text-text-muted">
            Bir içerik türü seçin, portföy bilgilerinden otomatik metin üretelim.
          </p>
        )}
      </div>
    </section>
  );
}
