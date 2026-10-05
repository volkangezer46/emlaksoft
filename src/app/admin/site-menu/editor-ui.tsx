"use client";

import { useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { AlertTriangle, ImageUp, Loader2, Search, X } from "lucide-react";
import { uploadSiteMenuMedia } from "@/app/actions/site-menu";
import { Input } from "@/components/ui/input";
import { renderMenuIcon } from "@/lib/site-menu/icon-node";
import { MENU_ICON_LIST } from "@/lib/site-menu/icon-registry";
import { MEDIA_LIMITS, type MediaRole } from "@/lib/site-menu/media";
import { HOME_ANCHORS, knownPublicPaths } from "@/lib/site-menu/known-routes";
import type { IconRef, Issue } from "@/lib/site-menu/schema";
import type { MediaEntry } from "@/lib/site-menu/store";

export const btn =
  "focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-3 py-2 text-xs font-semibold text-text-muted transition hover:border-brand-400 hover:text-ink-950 disabled:opacity-45";
export const btnPrimary =
  "focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-brand-600 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-brand-700 disabled:opacity-45";
export const iconBtn =
  "focus-ring press inline-grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-line text-text-muted transition hover:border-brand-400 hover:text-ink-950 disabled:opacity-35";

export const assetUrl = (id: string) => `/site-menu-asset/${id}`;

export function Field({ label, error, children, hint }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-semibold text-ink-950">{label}</span>
      {children}
      {error ? <span role="alert" className="mt-1 block text-xs font-semibold text-danger-500">{error}</span> : hint ? <span className="mt-1 block text-xs text-text-faint">{hint}</span> : null}
    </label>
  );
}

/** Yola göre ilk hata/uyarı mesajı. */
export function issueFor(issues: readonly Issue[], path: string, level?: Issue["level"]): Issue | undefined {
  return issues.find((i) => i.path === path && (!level || i.level === level));
}

export function FieldIssue({ issues, path }: { issues: readonly Issue[]; path: string }) {
  const err = issueFor(issues, path, "error");
  const warn = issueFor(issues, path, "warn");
  const i = err ?? warn;
  if (!i) return null;
  return (
    <span role={err ? "alert" : "status"} className={`mt-1 flex items-start gap-1 text-xs font-semibold ${err ? "text-danger-500" : "text-amber-700"}`}>
      <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {i.message}
    </span>
  );
}

/** Satır içi onay: popup yok; düğme "Emin misiniz?" satırına dönüşür. */
export function InlineConfirm({
  label,
  confirmLabel,
  onConfirm,
  disabled,
  tone = "default",
  icon,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  tone?: "default" | "danger";
  icon?: ReactNode;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className={btn} disabled={disabled} onClick={() => setAsking(true)}>
        {icon}
        {label}
      </button>
    );
  }
  return (
    <span role="group" aria-label={`${label} onayı`} className="inline-flex flex-wrap items-center gap-1.5 rounded-[var(--radius-control)] border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
      <span className="font-semibold">Emin misiniz?</span>
      <button
        type="button"
        className={`focus-ring rounded px-2 py-1 font-bold text-white ${tone === "danger" ? "bg-danger-500" : "bg-brand-600"}`}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className="focus-ring rounded px-2 py-1 font-semibold" onClick={() => setAsking(false)}>Vazgeç</button>
    </span>
  );
}

/** Medya yükleme: sunucu dosyayı doğrular; sonuç `onDone` ile döner. */
export function useMediaUpload(role: MediaRole, onDone: (m: MediaEntry) => void) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const upload = (file: File | null | undefined, input?: HTMLInputElement | null) => {
    if (!file) return;
    setError(null);
    const fd = new FormData();
    fd.set("role", role);
    fd.set("file", file);
    start(async () => {
      const res = await uploadSiteMenuMedia(fd);
      if (input) input.value = "";
      if (res.error || !res.media) {
        setError(res.error ?? "Yükleme başarısız.");
        return;
      }
      onDone(res.media);
    });
  };
  return { upload, pending, error };
}

export function MediaUploadButton({
  role,
  label,
  accept,
  onDone,
  disabled,
  hint,
}: {
  role: MediaRole;
  label: string;
  accept: string;
  onDone: (m: MediaEntry) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const { upload, pending, error } = useMediaUpload(role, onDone);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="min-w-0">
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-label={label}
        onChange={(e) => upload(e.target.files?.[0], e.target)}
        disabled={disabled || pending}
      />
      <button type="button" className={btn} disabled={disabled || pending} onClick={() => ref.current?.click()}>
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <ImageUp className="h-3.5 w-3.5" aria-hidden="true" />}
        {label}
      </button>
      {hint ? <p className="mt-1 text-xs text-text-faint">{hint}</p> : null}
      {error ? <p role="alert" className="mt-1 text-xs font-semibold text-danger-500">{error}</p> : null}
    </div>
  );
}

export const ICON_ACCEPT = ".svg,.png,.webp,image/svg+xml,image/png,image/webp";
export const STILL_ACCEPT = ICON_ACCEPT;
export const MOTION_ACCEPT = ".svg,.png,.apng,.webp,.gif,.webm,.mp4,image/svg+xml,image/png,image/apng,image/webp,image/gif,video/webm,video/mp4";
export const iconUploadHint = `SVG, PNG veya WebP; en çok ${MEDIA_LIMITS.iconBytes / 1024} KB (SVG ${MEDIA_LIMITS.svgBytes / 1024} KB), en çok 512x512 px.`;

const norm = (s: string) => s.toLocaleLowerCase("tr");

/** Aranabilir, önizlemeli ikon seçici (kontrollü liste) + özel logo yükleme. Satır içi açılır panel. */
export function IconPicker({
  value,
  onChange,
  onMedia,
  disabled,
  readOnlyMediaOk = true,
}: {
  value: IconRef;
  onChange: (v: IconRef) => void;
  onMedia: (m: MediaEntry) => void;
  disabled?: boolean;
  readOnlyMediaOk?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const panelId = useId();
  const list = useMemo(() => {
    const t = norm(q.trim());
    if (!t) return MENU_ICON_LIST;
    return MENU_ICON_LIST.filter((i) => norm(`${i.name} ${i.label} ${i.keywords}`).includes(t));
  }, [q]);

  return (
    <div className="min-w-0">
      <button
        type="button"
        className="focus-ring press inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-xs font-semibold text-ink-950 hover:border-brand-400 disabled:opacity-45"
        aria-expanded={open}
        aria-controls={panelId}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="grid h-6 w-6 place-items-center rounded-md bg-brand-600/10 text-brand-700">
          {value.kind === "none" ? <X className="h-3.5 w-3.5" aria-hidden="true" /> : renderMenuIcon(value, 16, assetUrl)}
        </span>
        {value.kind === "lucide" ? "İkon" : value.kind === "media" ? "Logo" : "Yok"}
      </button>
      {open ? (
        <div id={panelId} className="mt-2 rounded-[var(--radius-card)] border border-line bg-surface p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" aria-hidden="true" />
            <Input aria-label="İkon ara" placeholder="İkon ara (ör. takvim, kilit, bina)" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
          </div>
          <ul className="mt-2 grid max-h-52 grid-cols-5 gap-1.5 overflow-y-auto sm:grid-cols-7 lg:grid-cols-9" aria-label="İkon listesi">
            {list.map((i) => {
              const active = value.kind === "lucide" && value.name === i.name;
              return (
                <li key={i.name}>
                  <button
                    type="button"
                    title={i.label}
                    aria-label={i.label}
                    aria-pressed={active}
                    onClick={() => {
                      onChange({ kind: "lucide", name: i.name });
                      setOpen(false);
                    }}
                    className={`focus-ring grid h-10 w-full place-items-center rounded-[var(--radius-control)] border text-ink-950 transition hover:border-brand-400 ${active ? "border-brand-500 bg-brand-600/10" : "border-line"}`}
                  >
                    {renderMenuIcon({ kind: "lucide", name: i.name }, 18)}
                  </button>
                </li>
              );
            })}
            {list.length === 0 ? <li className="col-span-full py-3 text-center text-xs text-text-muted">Eşleşen ikon yok.</li> : null}
          </ul>
          <div className="mt-3 flex flex-wrap items-start gap-2 border-t border-line pt-3">
            <button type="button" className={btn} onClick={() => { onChange({ kind: "none" }); setOpen(false); }}>İkon yok</button>
            {readOnlyMediaOk ? (
              <MediaUploadButton
                role="icon"
                label="Özel logo yükle"
                accept={ICON_ACCEPT}
                hint={iconUploadHint}
                disabled={disabled}
                onDone={(m) => {
                  onMedia(m);
                  onChange({ kind: "media", mediaId: m.id });
                  setOpen(false);
                }}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Bağlantı kutusuna hızlı hedef önerileri (var olan sayfalar ve ana sayfa bölümleri). */
export function TargetDatalist() {
  return (
    <datalist id="site-menu-targets">
      {knownPublicPaths().map((p) => <option key={p} value={p} />)}
      {HOME_ANCHORS.map((a) => <option key={a} value={`/#${a}`} />)}
    </datalist>
  );
}
