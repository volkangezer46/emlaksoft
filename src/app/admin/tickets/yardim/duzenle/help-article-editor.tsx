"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EyeOff, Rocket, Save, Trash2, Undo2 } from "lucide-react";
import {
  deleteHelpArticleAction,
  discardHelpDraftAction,
  hideHelpArticleAction,
  publishHelpArticleAction,
  saveHelpArticleAction,
  type HelpArticleForm,
} from "@/app/actions/help-center-admin";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { HELP_KINDS, slugify, type HelpKind, type HelpStatus } from "@/lib/help-center/core";

type Msg = { ok: boolean; text: string } | null;

const LABELS: Record<HelpKind, { summary: string | null; body: string; bodyHint: string; hrefLabel: string }> = {
  guide: { summary: "Giriş (tek cümle)", body: "Adımlar", bodyHint: "Her satır bir adım. Menü ve düğme adlarını ekrandakiyle aynı yazın.", hrefLabel: "Düğme metni" },
  faq: { summary: null, body: "Yanıt", bodyHint: "Fiyat/tutar yazmayın; güncel fiyat /fiyatlar sayfasındadır (AI bağlamına fiyatlı yanıt gitmez).", hrefLabel: "Bağlantı adı" },
  glossary: { summary: "Kısa açıklama", body: "Ayrıntı", bodyHint: "İsteğe bağlı ek açıklama.", hrefLabel: "Bağlantı adı" },
};

/** Yardım makalesi formu (süper admin yazar; diğerleri salt okur). Tıklama anında düğme yükleniyor durumuna geçer. */
export function HelpArticleEditor({
  isNew,
  canWrite,
  fromCode,
  status,
  hasPendingEdit,
  initial,
  categories,
}: {
  isNew: boolean;
  canWrite: boolean;
  fromCode: boolean;
  status: HelpStatus | null;
  hasPendingEdit: boolean;
  initial: Omit<HelpArticleForm, "kind"> & { kind: HelpKind };
  categories: readonly { id: string; label: string }[];
}) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [slugTouched, setSlugTouched] = useState(!isNew);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const saved = !isNew && status !== null;
  const L = LABELS[f.kind];
  const ro = !canWrite;

  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) {
    setF((p) => {
      const next = { ...p, [k]: v };
      if (k === "title" && isNew && !slugTouched) next.slug = slugify(String(v));
      return next;
    });
  }

  function run(fn: () => Promise<{ ok: true; message?: string; slug?: string } | { ok: false; error: string }>, after?: (slug?: string) => void) {
    setMsg(null);
    start(async () => {
      const r = await fn().catch(() => ({ ok: false as const, error: "Bağlantı hatası; tekrar deneyin." }));
      if (!r.ok) {
        setMsg({ ok: false, text: r.error });
        return;
      }
      setMsg({ ok: true, text: r.message ?? "Tamam." });
      if (after) after(r.slug);
      else router.refresh();
    });
  }

  const save = () =>
    run(
      () => saveHelpArticleAction(f, isNew),
      (slug) => (isNew && slug ? router.replace(`/admin/tickets/yardim/duzenle?tur=${f.kind}&slug=${encodeURIComponent(slug)}`) : router.refresh()),
    );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="grid max-w-3xl gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Tür" htmlFor="ha-kind">
          <FormSelect id="ha-kind" value={f.kind} disabled={!isNew || ro} onChange={(e) => set("kind", e.target.value as HelpKind)}>
            {HELP_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </FormSelect>
        </FormField>
        <FormField label="Kısa ad (slug)" htmlFor="ha-slug" required hint="Bağlantı çapası; sonradan değişmez.">
          <FormInput
            id="ha-slug"
            value={f.slug}
            disabled={!isNew || ro}
            maxLength={80}
            onChange={(e) => {
              setSlugTouched(true);
              set("slug", e.target.value.toLowerCase());
            }}
          />
        </FormField>
        <FormField label="Sıra" htmlFor="ha-sort" hint="Küçük sayı önce (yeni makaleler kodun ardından).">
          <FormInput id="ha-sort" type="number" min={0} max={10000} value={f.sort} disabled={ro} onChange={(e) => set("sort", Number(e.target.value))} />
        </FormField>
      </div>
      <FormField label={f.kind === "faq" ? "Soru" : f.kind === "glossary" ? "Terim" : "Başlık"} htmlFor="ha-title" required>
        <FormInput id="ha-title" value={f.title} maxLength={200} disabled={ro} onChange={(e) => set("title", e.target.value)} />
      </FormField>
      {f.kind === "faq" ? (
        <FormField label="Kategori" htmlFor="ha-cat">
          <FormSelect id="ha-cat" value={f.category} disabled={ro} onChange={(e) => set("category", e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </FormSelect>
        </FormField>
      ) : null}
      {L.summary ? (
        <FormField label={L.summary} htmlFor="ha-summary" required={f.kind !== "guide"}>
          <FormTextarea id="ha-summary" rows={2} value={f.summary} maxLength={1000} disabled={ro} onChange={(e) => set("summary", e.target.value)} />
        </FormField>
      ) : null}
      <FormField label={L.body} htmlFor="ha-body" required={f.kind !== "glossary"} hint={L.bodyHint}>
        <FormTextarea id="ha-body" rows={8} value={f.body} maxLength={20000} disabled={ro} onChange={(e) => set("body", e.target.value)} />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Bağlantı (site içi yol)" htmlFor="ha-href" hint="ör. /app/musteriler">
          <FormInput id="ha-href" value={f.href} maxLength={300} disabled={ro} onChange={(e) => set("href", e.target.value)} />
        </FormField>
        <FormField label={L.hrefLabel} htmlFor="ha-href-label">
          <FormInput id="ha-href-label" value={f.hrefLabel} maxLength={80} disabled={ro} onChange={(e) => set("hrefLabel", e.target.value)} />
        </FormField>
      </div>
      {msg ? (
        <p role="status" className={`text-sm ${msg.ok ? "text-mint-700" : "text-danger-600"}`}>
          {msg.text}
        </p>
      ) : null}
      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="outline" icon={Save} loading={pending} disabled={pending || !f.title.trim() || !f.slug.trim()}>
            Taslağı kaydet
          </Button>
          {saved ? (
            <Button type="button" icon={Rocket} disabled={pending} onClick={() => run(() => publishHelpArticleAction(f.kind, f.slug))}>
              Yayınla
            </Button>
          ) : null}
          {!isNew && status !== "hidden" ? (
            <ConfirmDialog
              tone="default"
              title="Bu madde gizlensin mi?"
              description="Ofislerin Yardım ekranından ve AI asistanın SSS bağlamından hemen kalkar. Sonra yeniden yayınlayabilirsiniz."
              confirmLabel="Gizle"
              onConfirm={() => run(() => hideHelpArticleAction(f.kind, f.slug))}
              trigger={
                <Button type="button" variant="ghost" icon={EyeOff} disabled={pending}>
                  Gizle
                </Button>
              }
            />
          ) : null}
          {hasPendingEdit && status === "published" ? (
            <Button type="button" variant="ghost" icon={Undo2} disabled={pending} onClick={() => run(() => discardHelpDraftAction(f.kind, f.slug))}>
              Bekleyen düzenlemeyi at
            </Button>
          ) : null}
          {saved ? (
            <ConfirmDialog
              title={fromCode ? "Koddaki metne dönülsün mü?" : "Makale silinsin mi?"}
              description={fromCode ? "Bu maddedeki değişiklikler silinir ve koddaki metin geri gelir." : "Makale ve bekleyen düzenlemesi kalıcı olarak silinir."}
              confirmLabel={fromCode ? "Koddaki metne dön" : "Sil"}
              onConfirm={() => run(() => deleteHelpArticleAction(f.kind, f.slug), () => router.push("/admin/tickets/yardim"))}
              trigger={
                <Button type="button" variant="ghost" icon={Trash2} disabled={pending}>
                  {fromCode ? "Koddaki metne dön" : "Sil"}
                </Button>
              }
            />
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-text-muted">Yalnız süper admin düzenleyebilir.</p>
      )}
    </form>
  );
}
