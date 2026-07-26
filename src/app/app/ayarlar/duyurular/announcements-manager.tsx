"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Info, Loader2, Megaphone, Pencil, Pin, Plus, Trash2, TriangleAlert, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncementForm,
  type AnnouncementResult,
} from "@/app/actions/announcements";

export type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  level: string;
  pinned: boolean;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
  creatorName: string | null;
  readCount: number;
};

const LEVEL_META: Record<string, { label: string; badge: string; icon: React.ComponentType<{ className?: string }> }> = {
  info: { label: "Bilgi", badge: "bg-brand-600/10 text-brand-600", icon: Info },
  warning: { label: "Uyarı", badge: "bg-amber-400/15 text-amber-600", icon: TriangleAlert },
  success: { label: "Müjde", badge: "bg-mint-500/12 text-mint-600", icon: CheckCircle2 },
};

const init: AnnouncementResult = {};

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" });
}

/** ISO → datetime-local input değeri (yerel saat, dakika hassasiyeti). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AnnouncementsManager({ announcements, teamCount }: { announcements: AnnouncementRow[]; teamCount: number }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [editing, setEditing] = useState<AnnouncementRow | null>(null);
  // Yeni duyuru: useActionState (başarıda form reset). Düzenleme: transition
  // içinde doğrudan action çağrısı — başarıda setEditing(null) event akışında
  // kalır (effect içi setState lint kuralına takılmaz).
  const [createState, createAction, createPending] = useActionState(createAnnouncement, init);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updatePending, startUpdate] = useTransition();

  const errorMsg = editing ? updateError : createState.error;
  const pending = editing ? updatePending : createPending;

  useEffect(() => {
    if (createState.ok) {
      formRef.current?.reset();
      router.refresh();
    }
  }, [createState, router]);

  function handleUpdate(fd: FormData) {
    startUpdate(async () => {
      const res = await updateAnnouncement(init, fd);
      if (res.error) {
        setUpdateError(res.error);
      } else {
        setUpdateError(null);
        setEditing(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.35fr]">
      {/* Yeni duyuru / düzenleme formu */}
      <section className="dashboard-panel h-fit rounded-[20px] border border-line bg-surface p-6">
        <div className="flex items-center justify-between gap-3 border-b border-line pb-4">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-brand-600/10 text-brand-600">
              {editing ? <Pencil className="h-5 w-5" /> : <Megaphone className="h-5 w-5" />}
            </span>
            <div>
              <h2 className="font-display font-bold text-ink-950">{editing ? "Duyuruyu düzenle" : "Yeni duyuru"}</h2>
              <p className="text-xs text-text-muted">
                {editing ? "Değişiklik anında herkesin bandına yansır." : "Yayınlanınca tüm ekibe bildirim gider."}
              </p>
            </div>
          </div>
          {editing ? (
            <button
              type="button"
              onClick={() => { setEditing(null); setUpdateError(null); }}
              className="focus-ring press inline-flex items-center gap-1 rounded-[9px] border border-line px-2.5 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600"
            >
              <X className="h-3.5 w-3.5" /> Vazgeç
            </button>
          ) : null}
        </div>

        <form
          ref={formRef}
          key={editing?.id ?? "new"}
          action={editing ? handleUpdate : createAction}
          className="mt-5 space-y-4"
        >
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}

          <div>
            <label htmlFor="ann-title" className="text-xs font-bold text-text-muted">Başlık</label>
            <input
              id="ann-title"
              name="title"
              required
              maxLength={200}
              defaultValue={editing?.title ?? ""}
              placeholder="Örn. Cuma ofis toplantısı 10:00"
              className="focus-ring mt-1.5 w-full rounded-[11px] border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink-950 placeholder:text-text-faint"
            />
          </div>

          <div>
            <label htmlFor="ann-body" className="text-xs font-bold text-text-muted">Duyuru metni</label>
            <textarea
              id="ann-body"
              name="body"
              required
              maxLength={4000}
              rows={4}
              defaultValue={editing?.body ?? ""}
              placeholder="Detayları buraya yazın — ekip dashboard bandında görecek."
              className="focus-ring mt-1.5 w-full resize-y rounded-[11px] border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink-950 placeholder:text-text-faint"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="ann-level" className="text-xs font-bold text-text-muted">Seviye</label>
              <select
                id="ann-level"
                name="level"
                defaultValue={editing?.level ?? "info"}
                className="focus-ring mt-1.5 w-full rounded-[11px] border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink-950"
              >
                <option value="info">Bilgi</option>
                <option value="warning">Uyarı</option>
                <option value="success">Müjde</option>
              </select>
            </div>
            <div>
              <label htmlFor="ann-ends" className="text-xs font-bold text-text-muted">Yayın bitişi (opsiyonel)</label>
              <input
                id="ann-ends"
                name="ends_at"
                type="datetime-local"
                defaultValue={toLocalInput(editing?.ends_at ?? null)}
                className="focus-ring mt-1.5 w-full rounded-[11px] border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink-950"
              />
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 rounded-[11px] border border-line bg-canvas px-3.5 py-2.5">
            <input
              type="checkbox"
              name="pinned"
              defaultChecked={editing?.pinned ?? false}
              className="h-4 w-4 accent-[var(--brand-600)]"
            />
            <span className="flex items-center gap-1.5 text-sm font-semibold text-ink-950">
              <Pin className="h-3.5 w-3.5 text-brand-600" /> Sabitle
            </span>
            <span className="text-xs text-text-muted">— bantta her zaman en üstte</span>
          </label>

          {errorMsg ? (
            <p className="rounded-[10px] border border-danger-500/25 bg-danger-500/8 px-3 py-2 text-xs font-semibold text-danger-500">
              {errorMsg}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="focus-ring press inline-flex w-full items-center justify-center gap-2 rounded-[11px] bg-brand-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {editing ? "Değişiklikleri kaydet" : "Duyuruyu yayınla"}
          </button>
        </form>
      </section>

      {/* Duyuru listesi */}
      <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-6">
        <div className="flex items-center justify-between border-b border-line pb-4">
          <div>
            <h2 className="font-display font-bold text-ink-950">Yayınlanan duyurular</h2>
            <p className="text-xs text-text-muted">Okunma durumu ekipteki {teamCount} aktif kullanıcıya göre hesaplanır.</p>
          </div>
          <span className="rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-bold text-brand-600">{announcements.length}</span>
        </div>

        {announcements.length === 0 ? (
          <div className="mt-8 flex flex-col items-center gap-2 pb-4 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-600/10 text-brand-600">
              <Megaphone className="h-6 w-6" />
            </span>
            <p className="text-sm font-semibold text-ink-950">Henüz duyuru yok</p>
            <p className="max-w-xs text-xs text-text-muted">
              İlk duyurunuzu yayınlayın — ekibin dashboard&apos;unda anında görünür ve herkese bildirim gider.
            </p>
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {announcements.map((a) => {
              const meta = LEVEL_META[a.level] ?? LEVEL_META.info;
              const LevelIcon = meta.icon;
              return (
                <li key={a.id} className="rounded-[14px] border border-line bg-canvas p-4 transition hover:border-brand-300">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-sm font-bold text-ink-950">
                        {a.pinned ? <Pin className="h-3.5 w-3.5 shrink-0 text-brand-600" /> : null}
                        <span className="truncate">{a.title}</span>
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-text-muted">{a.body}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => { setEditing(a); setUpdateError(null); }}
                        title="Düzenle"
                        className="focus-ring press grid h-8 w-8 place-items-center rounded-[9px] border border-line text-text-muted transition hover:border-brand-300 hover:text-brand-600"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <ConfirmDialog
                        trigger={
                          <button
                            type="button"
                            title="Sil"
                            className="focus-ring press grid h-8 w-8 place-items-center rounded-[9px] border border-line text-text-muted transition hover:border-danger-500/40 hover:text-danger-500"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        }
                        title="Duyuru silinsin mi?"
                        description={`"${a.title}" duyurusu ve okunma kayıtları kalıcı olarak silinir.`}
                        confirmLabel="Kalıcı sil"
                        formAction={deleteAnnouncementForm}
                        hiddenFields={{ id: a.id }}
                      />
                    </div>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] text-text-faint">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold ${meta.badge}`}>
                      <LevelIcon className="h-3 w-3" /> {meta.label}
                    </span>
                    <span>
                      {fmtDate(a.starts_at)}
                      {a.ends_at ? ` → ${fmtDate(a.ends_at)}` : " → süresiz"}
                    </span>
                    {a.creatorName ? <span>· {a.creatorName}</span> : null}
                    <span
                      className={`ml-auto rounded-full px-2 py-0.5 font-bold ${
                        teamCount > 0 && a.readCount >= teamCount
                          ? "bg-mint-500/12 text-mint-600"
                          : "bg-ink-950/8 text-text-muted"
                      }`}
                      title="Okundu işaretleyen / aktif ekip"
                    >
                      {a.readCount}/{teamCount} okudu
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
