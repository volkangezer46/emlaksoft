"use client";

import { useDeferredValue, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Rocket, RotateCcw, Save, Trash2 } from "lucide-react";
import {
  deleteLegalDraftAction,
  publishLegalDraftAction,
  restoreLegalVersionAction,
  revertLegalToCodeAction,
  saveLegalDraftAction,
  startLegalDraftFromLiveAction,
} from "@/app/actions/legal-admin";
import { LegalMarkupBody } from "@/components/legal-markup";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField, FormInput, FormTextarea } from "@/components/ui/form-controls";
import type { SupportContact } from "@/lib/contact-info";
import type { LegalEntityField } from "@/lib/legal-entity";

type Draft = { version: number; title: string; intro: string; body: string; requiresReconsent: boolean; changeNote: string };
type Msg = { ok: boolean; text: string } | null;

const HELP =
  "Biçim: ## 1. Başlık (bölüm), boş satır (yeni paragraf), - madde, **kalın**, [metin](/yol). Şirket kimliği listesi için tek satıra {{sirket_kimligi}}, destek e-postası için {{destek_eposta}} yazın.";

/**
 * Yasal belge taslak düzenleyicisi: yazarken canlı önizleme (ertelenmiş değer: yazma akıcı kalır), kaydet / yayınla /
 * taslağı sil, yayındaki metinden taslak başlat ve koddaki metne dön. Yazma yalnız süper admin; diğerleri salt okur.
 */
export function LegalDocEditor({
  slug,
  canEdit,
  hasLive,
  draft,
  seed,
  contact,
  entity,
  issues,
}: {
  slug: string;
  canEdit: boolean;
  hasLive: boolean;
  draft: Draft | null;
  seed: { title: string; intro: string; body: string } | null;
  contact: SupportContact;
  entity: readonly LegalEntityField[];
  issues: readonly string[];
}) {
  const router = useRouter();
  const base = draft ?? (seed ? { ...seed, requiresReconsent: false, changeNote: "" } : { title: "", intro: "", body: "", requiresReconsent: false, changeNote: "" });
  const [title, setTitle] = useState(base.title);
  const [intro, setIntro] = useState(base.intro);
  const [body, setBody] = useState(base.body);
  const [reconsent, setReconsent] = useState(base.requiresReconsent);
  const [note, setNote] = useState(base.changeNote);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const preview = useDeferredValue(body);
  const dirty = !draft || title !== draft.title || intro !== draft.intro || body !== draft.body || reconsent !== draft.requiresReconsent || note !== draft.changeNote;

  function run(fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>) {
    setMsg(null);
    start(async () => {
      const r = await fn().catch(() => ({ ok: false as const, error: "Bağlantı hatası; tekrar deneyin." }));
      setMsg(r.ok ? { ok: true, text: r.message ?? "Tamam." } : { ok: false, text: r.error });
      if (r.ok) router.refresh();
    });
  }

  const save = () => run(() => saveLegalDraftAction(slug, { title, intro, body, requiresReconsent: reconsent, changeNote: note }));
  const publish = () => run(() => publishLegalDraftAction(slug));

  return (
    <section aria-label="Taslak" className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink-950">{draft ? `Taslak v${draft.version}` : "Yeni taslak"}</h2>
          {canEdit && !draft ? (
            <Button type="button" variant="outline" size="sm" icon={Download} disabled={pending} onClick={() => run(() => startLegalDraftFromLiveAction(slug))}>
              Yayındaki metinden taslak başlat
            </Button>
          ) : null}
        </div>
        <FormField label="Başlık" htmlFor="ld-title" required>
          <FormInput id="ld-title" value={title} maxLength={200} disabled={!canEdit} onChange={(e) => setTitle(e.target.value)} />
        </FormField>
        <FormField label="Giriş metni" htmlFor="ld-intro" hint="Boş bırakılırsa koddaki giriş metni kullanılır.">
          <FormTextarea id="ld-intro" rows={2} value={intro} maxLength={1000} disabled={!canEdit} onChange={(e) => setIntro(e.target.value)} />
        </FormField>
        <FormField label="Belge metni" htmlFor="ld-body" required hint={HELP}>
          <FormTextarea id="ld-body" rows={18} value={body} disabled={!canEdit} onChange={(e) => setBody(e.target.value)} className="font-mono text-xs" />
        </FormField>
        <FormField label="Değişiklik notu" htmlFor="ld-note" hint="Geçmişte görünür (ör. 'Cayma süresi maddesi güncellendi').">
          <FormInput id="ld-note" value={note} maxLength={500} disabled={!canEdit} onChange={(e) => setNote(e.target.value)} />
        </FormField>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-text">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={reconsent} disabled={!canEdit} onChange={(e) => setReconsent(e.target.checked)} />
          <span>
            <b>Yeniden onay gerekli</b> (önemli değişiklik): yayından sonra mevcut kullanıcılar bir sonraki girişte metni onaylar; onay IP ve zamanla kaydedilir.
          </span>
        </label>
        {issues.length ? (
          <ul className="list-disc space-y-1 rounded-[var(--radius-control)] bg-amber-50 p-3 pl-6 text-xs text-amber-900">
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        ) : null}
        {msg ? (
          <p role="status" className={`text-sm ${msg.ok ? "text-mint-700" : "text-danger-600"}`}>
            {msg.text}
          </p>
        ) : null}
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" icon={Save} loading={pending} disabled={pending || !dirty || !title.trim() || !body.trim()} onClick={save}>
              Taslağı kaydet
            </Button>
            {draft?.requiresReconsent ? (
              <ConfirmDialog
                tone="default"
                title={`v${draft.version} yeniden onayla yayınlansın mı?`}
                description="Mevcut tüm kullanıcılar bir sonraki girişte yeni metni onaylamadan devam edemez; onaylar IP ve zamanla kaydedilir."
                confirmLabel="Yayınla"
                onConfirm={publish}
                trigger={
                  <Button type="button" icon={Rocket} disabled={pending || dirty} title={dirty ? "Önce taslağı kaydedin" : undefined}>
                    Yayınla
                  </Button>
                }
              />
            ) : (
              <Button type="button" icon={Rocket} disabled={pending || !draft || dirty} onClick={publish} title={dirty ? "Önce taslağı kaydedin" : undefined}>
                Yayınla
              </Button>
            )}
            {draft ? (
              <ConfirmDialog
                title="Taslak silinsin mi?"
                description="Kaydedilmiş taslak kalıcı olarak silinir; yayındaki metin değişmez."
                confirmLabel="Taslağı sil"
                onConfirm={() => run(() => deleteLegalDraftAction(slug))}
                trigger={
                  <Button type="button" variant="ghost" icon={Trash2} disabled={pending}>
                    Taslağı sil
                  </Button>
                }
              />
            ) : null}
            {hasLive ? (
              <ConfirmDialog
                title="Koddaki metne dönülsün mü?"
                description="Yayındaki sürüm arşive alınır ve sayfa koddaki metni gösterir. Sürüm geçmişi silinmez."
                confirmLabel="Koddaki metne dön"
                onConfirm={() => run(() => revertLegalToCodeAction(slug))}
                trigger={
                  <Button type="button" variant="ghost" icon={RotateCcw} disabled={pending}>
                    Koddaki metne dön
                  </Button>
                }
              />
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-text-muted">Yalnız süper admin düzenleyebilir.</p>
        )}
      </div>
      <div className="rounded-[var(--radius-card)] border border-line bg-canvas p-4">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.08em] text-text-muted">Önizleme</p>
        <h3 className="font-display text-xl font-extrabold text-ink-950">{title || "Başlıksız"}</h3>
        {intro ? <p className="mt-1 text-sm text-text-muted">{intro}</p> : null}
        <div className="legal-body mt-4 space-y-8">
          <LegalMarkupBody body={preview} contact={contact} entity={entity} />
        </div>
      </div>
    </section>
  );
}

/** Sürüm geçmişi satır eylemleri: arşivdeki sürüme dön (yeni sürüm olarak yayınlanır). */
export function VersionActions({ slug, version, live, hasDraft }: { slug: string; version: number; live: boolean; hasDraft: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  if (live) return <span className="text-xs text-text-muted">Yayında</span>;
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <ConfirmDialog
        tone="default"
        title={`v${version} metnine dönülsün mü?`}
        description="Bu sürümün metni yeni sürüm numarasıyla hemen yayınlanır (yeniden onay istenmez). Geçmiş korunur."
        confirmLabel="Bu sürüme dön"
        onConfirm={() =>
          start(async () => {
            setErr(null);
            const r = await restoreLegalVersionAction(slug, version);
            if (r.ok) router.refresh();
            else setErr(r.error);
          })
        }
        trigger={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={RotateCcw}
            disabled={pending || hasDraft}
            title={hasDraft ? "Önce bekleyen taslağı yayınlayın ya da silin" : undefined}
          >
            Bu sürüme dön
          </Button>
        }
      />
      {err ? <span className="text-xs text-danger-600">{err}</span> : null}
    </span>
  );
}
