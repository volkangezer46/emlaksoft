"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Camera,
  Check,
  CheckCheck,
  ChevronDown,
  FileSignature,
  KeyRound,
  Loader2,
  Lock,
  Minus,
  Plus,
  Receipt,
  RotateCcw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import {
  createInspectionContract,
  deleteInspectionPhoto,
  finalizeInspection,
  finalizeInspectionPhoto,
  prepareInspectionPhoto,
  reopenInspection,
  saveInspection,
} from "@/app/actions/rental-inspections";
import { uploadToDirectFileTarget } from "@/lib/direct-file-upload-client";
import { useToast } from "@/components/app/toast-provider";
import { Button, ButtonLink } from "@/components/ui/button";
import { PrintButton } from "@/components/ui/print-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField, FormInput, FormTextarea } from "@/components/ui/form-controls";
import { now } from "@/lib/clock";
import { formatDateTimeTr } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  CONDITIONS,
  CONDITION_LABELS,
  METER_KEYS,
  METER_LABELS,
  METER_UNITS,
  newKey,
  type Condition,
  type InspectionKind,
  type InspectionRoom,
  type KeyEntry,
  type Meters,
} from "@/lib/rentals/inspection";

export type EditorPhoto = { id: string; itemKey: string; url: string | null };

const COND_STYLE: Record<Condition, string> = {
  good: "aria-checked:border-mint-500 aria-checked:bg-mint-500/12 aria-checked:text-mint-700",
  worn: "aria-checked:border-amber-500 aria-checked:bg-amber-400/15 aria-checked:text-amber-800",
  damaged: "aria-checked:border-danger-500 aria-checked:bg-danger-500/10 aria-checked:text-danger-700",
  missing: "aria-checked:border-danger-600 aria-checked:bg-danger-600/12 aria-checked:text-danger-700",
};

/** Telefon fotoğrafını (3-8 MB) yüklemeden önce 1600 px JPEG'e küçültür; başarısızsa özgün dosya gider. */
async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size < 900_000 || typeof createImageBitmap !== "function") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

function hhmm(ms: number) {
  return formatDateTimeTr(ms, { hour: "2-digit", minute: "2-digit" });
}

/**
 * Tutanak düzenleyici (mobil öncelikli). Her değişiklik 1,5 sn sonra taslak olarak kaydedilir; fotoğraf için tutanak
 * önce kaydedilir. Kesinleşen tutanak salt okunurdur; imza taslağı mevcut SMS OTP akışına gider. Hover'a bağlı eylem yok,
 * tüm hedefler ≥ 44 px.
 */
export function InspectionEditor({
  rentalId,
  kind,
  inspectionId: initialId,
  status,
  contractId,
  contractStatus,
  initial,
  before,
  photos: initialPhotos,
  canEdit,
  canSign,
  depositReturned,
}: {
  rentalId: string;
  kind: InspectionKind;
  inspectionId: string | null;
  status: "draft" | "final";
  contractId: string | null;
  contractStatus: string | null;
  initial: { inspectedOn: string; rooms: InspectionRoom[]; meters: Meters; keys: KeyEntry[]; notes: string };
  before: Record<string, Condition> | null;
  photos: EditorPhoto[];
  canEdit: boolean;
  canSign: boolean;
  depositReturned: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const readOnly = !canEdit || status === "final";
  const [inspectionId, setInspectionId] = useState(initialId);
  const [inspectedOn, setInspectedOn] = useState(initial.inspectedOn);
  const [rooms, setRooms] = useState<InspectionRoom[]>(initial.rooms);
  const [meters, setMeters] = useState<Meters>(initial.meters);
  const [keys, setKeys] = useState<KeyEntry[]>(initial.keys);
  const [notes, setNotes] = useState(initial.notes);
  const [photos, setPhotos] = useState<EditorPhoto[]>(initialPhotos);
  const [open, setOpen] = useState<string | null>(initial.rooms[0]?.key ?? null);
  const [version, setVersion] = useState(0);
  const [saveState, setSaveState] = useState<{ kind: "idle" | "saving" | "saved" | "error"; at?: number; msg?: string }>({ kind: initialId ? "saved" : "idle" });
  const [uploading, setUploading] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [newRoom, setNewRoom] = useState("");
  const [savedVersion, setSavedVersion] = useState(0);

  const touch = () => setVersion((v) => v + 1);

  // Kayıtlar sıraya girer: ilk kayıt (INSERT) sürerken gelen otomatik kayıt/fotoğraf kaydı ikinci satır açmaya çalışmaz.
  const inflight = useRef<Promise<string | null> | null>(null);
  function persist(): Promise<string | null> {
    const run = (inflight.current ?? Promise.resolve(null)).then(() => doPersist());
    const tracked: Promise<string | null> = run.finally(() => {
      if (inflight.current === tracked) inflight.current = null;
    });
    inflight.current = tracked;
    return run;
  }

  async function doPersist(): Promise<string | null> {
    const v = version;
    setSaveState({ kind: "saving" });
    const res = await saveInspection({ rentalId, kind, inspectedOn, rooms, meters, keys, notes });
    if (res.error || !res.id) {
      setSaveState({ kind: "error", msg: res.error ?? "Kaydedilemedi" });
      return null;
    }
    setSavedVersion((cur) => Math.max(cur, v));
    setInspectionId(res.id);
    setSaveState({ kind: "saved", at: now() });
    return res.id;
  }

  // Otomatik kayıt: son değişiklikten 1,5 sn sonra (yalnız düzenlenebilir taslak).
  useEffect(() => {
    if (readOnly || version === 0 || version === savedVersion) return;
    const t = setTimeout(() => {
      void persist();
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, readOnly, savedVersion]);

  const updateItem = (roomKey: string, itemKey: string, patch: Partial<{ label: string; condition: Condition; note: string }>) => {
    setRooms((rs) => rs.map((r) => (r.key !== roomKey ? r : { ...r, items: r.items.map((it) => (it.key === itemKey ? { ...it, ...patch } : it)) })));
    touch();
  };
  const allKeys = () => new Set(rooms.flatMap((r) => [r.key, ...r.items.map((i) => i.key)]));
  const addItem = (roomKey: string) => {
    const key = newKey(roomKey, allKeys());
    setRooms((rs) => rs.map((r) => (r.key !== roomKey ? r : { ...r, items: [...r.items, { key, label: "Yeni kalem", condition: "good", note: "" }] })));
    touch();
  };
  const removeItem = (roomKey: string, itemKey: string) => {
    setRooms((rs) => rs.map((r) => (r.key !== roomKey ? r : { ...r, items: r.items.filter((i) => i.key !== itemKey) })));
    touch();
  };
  const addRoom = () => {
    const name = newRoom.trim();
    if (!name) return;
    const key = newKey("oda", allKeys());
    setRooms((rs) => [...rs, { key, name: name.slice(0, 80), items: [{ key: `${key}-1`, label: "Duvar ve boya", condition: "good", note: "" }, { key: `${key}-2`, label: "Zemin", condition: "good", note: "" }] }]);
    setNewRoom("");
    setOpen(key);
    touch();
  };
  const removeRoom = (roomKey: string) => {
    setRooms((rs) => rs.filter((r) => r.key !== roomKey));
    touch();
  };
  const allGood = (roomKey: string) => {
    setRooms((rs) => rs.map((r) => (r.key !== roomKey ? r : { ...r, items: r.items.map((i) => ({ ...i, condition: "good" as Condition })) })));
    touch();
  };

  async function addPhoto(itemKey: string, raw: File | undefined) {
    if (!raw) return;
    setUploading(itemKey);
    try {
      const id = inspectionId ?? (await persist());
      if (!id) {
        push("Fotoğraf için önce tutanak kaydedilmeli; bağlantınızı kontrol edin.", "err");
        return;
      }
      const file = await shrinkImage(raw);
      const prepared = await prepareInspectionPhoto(id, itemKey, { fileName: file.name, fileSize: file.size, fileType: file.type });
      if (!prepared.ok) {
        push(prepared.error, "err");
        return;
      }
      const up = await uploadToDirectFileTarget(prepared.upload, file);
      if (!up.ok) {
        push(up.error, "err");
        return;
      }
      const done = await finalizeInspectionPhoto(prepared.upload.sessionId);
      if (!done.ok || !done.id) {
        push(done.error ?? "Fotoğraf doğrulanamadı.", "err");
        return;
      }
      setPhotos((ps) => [...ps, { id: done.id!, itemKey, url: done.url ?? null }]);
    } catch {
      push("Fotoğraf yüklenemedi. Lütfen tekrar deneyin.", "err");
    } finally {
      setUploading(null);
    }
  }

  async function removePhoto(id: string) {
    const res = await deleteInspectionPhoto(id);
    if (res.error) push(res.error, "err");
    else setPhotos((ps) => ps.filter((p) => p.id !== id));
  }

  const finalize = () =>
    new Promise<void>((resolve) =>
      start(async () => {
        const id = version !== savedVersion || !inspectionId ? await persist() : inspectionId;
        if (!id) return resolve();
        const res = await finalizeInspection(id);
        if (res.error) push(res.error, "err");
        else {
          push("Tutanak kesinleşti", "ok");
          router.refresh();
        }
        resolve();
      }),
    );
  const reopen = () =>
    new Promise<void>((resolve) =>
      start(async () => {
        if (!inspectionId) return resolve();
        const res = await reopenInspection(inspectionId);
        if (res.error) push(res.error, "err");
        else {
          push("Tutanak yeniden düzenlenebilir", "ok");
          router.refresh();
        }
        resolve();
      }),
    );
  const toSign = () =>
    start(async () => {
      if (!inspectionId) return;
      const res = await createInspectionContract(inspectionId);
      if (res.error || !res.id) {
        push(res.error ?? "İmza taslağı oluşturulamadı.", "err");
        return;
      }
      push("İmza taslağı hazır: imzalayanları ekleyip gönderin", "ok");
      router.push(`/app/sozlesmeler/${res.id}`);
    });

  const photosOf = (itemKey: string) => photos.filter((p) => p.itemKey === itemKey);
  const signLocked = contractStatus === "sent" || contractStatus === "signed";

  return (
    <div className="space-y-4">
      <section className="grid gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-end">
        <FormField label="Tutanak tarihi" htmlFor="insp-date">
          <FormInput type="date" value={inspectedOn} disabled={readOnly} onChange={(e) => { setInspectedOn(e.target.value); touch(); }} />
        </FormField>
        <p className="text-xs text-text-muted" role="status" aria-live="polite">
          {readOnly ? (
            <span className="inline-flex items-center gap-1.5 font-semibold"><Lock className="h-3.5 w-3.5" aria-hidden="true" /> {status === "final" ? "Kesinleşmiş tutanak (salt okunur)" : "Görüntüleme yetkisi"}</span>
          ) : saveState.kind === "saving" ? (
            <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Kaydediliyor…</span>
          ) : saveState.kind === "error" ? (
            <span className="font-semibold text-danger-600">Kaydedilemedi: {saveState.msg}</span>
          ) : saveState.kind === "saved" && version === savedVersion ? (
            <span className="inline-flex items-center gap-1.5 text-mint-700"><Check className="h-3.5 w-3.5" aria-hidden="true" /> Taslak kaydedildi{saveState.at ? ` ${hhmm(saveState.at)}` : ""}</span>
          ) : version > 0 ? (
            "Değişiklikler birazdan otomatik kaydedilir"
          ) : (
            "Odaları gezin, her kalemin durumunu işaretleyin. Değişiklikler otomatik kaydedilir."
          )}
        </p>
      </section>

      <ol className="space-y-3" aria-label="Odalar">
        {rooms.map((room) => {
          const isOpen = open === room.key;
          const issues = room.items.filter((i) => i.condition !== "good").length;
          return (
            <li key={room.key} className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-xs)]">
              <Button
                variant="ghost"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : room.key)}
                className="h-auto min-h-14 w-full justify-between gap-3 rounded-none px-4 py-3 text-left touch:h-auto"
              >
                <span className="min-w-0">
                  <span className="block truncate font-display text-base font-bold text-ink-950">{room.name}</span>
                  <span className="block text-xs text-text-muted">
                    {room.items.length} kalem{issues > 0 ? <> · <span className="font-semibold text-amber-700">{issues} sorunlu</span></> : " · hepsi iyi"}
                    {photos.some((p) => room.items.some((i) => i.key === p.itemKey)) ? ` · ${photos.filter((p) => room.items.some((i) => i.key === p.itemKey)).length} foto` : ""}
                  </span>
                </span>
                <ChevronDown className={cn("h-5 w-5 shrink-0 text-text-muted transition", isOpen && "rotate-180")} aria-hidden="true" />
              </Button>
              {isOpen ? (
                <div className="space-y-3 border-t border-line px-3 pb-4 pt-3 sm:px-4">
                  {!readOnly ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <FormInput
                        aria-label="Oda adı"
                        className="max-w-xs"
                        value={room.name}
                        maxLength={80}
                        onChange={(e) => { const v = e.target.value; setRooms((rs) => rs.map((r) => (r.key === room.key ? { ...r, name: v } : r))); touch(); }}
                      />
                      <Button variant="outline" size="sm" icon={CheckCheck} onClick={() => allGood(room.key)}>Tümü iyi</Button>
                      <ConfirmDialog
                        trigger={<Button variant="ghost" size="sm" icon={Trash2}>Odayı sil</Button>}
                        title={`${room.name} odasını sil`}
                        description="Oda ve kalemleri tutanaktan çıkarılır. Yüklenen fotoğraflar kalemlerden ayrılır."
                        confirmLabel="Sil"
                        onConfirm={() => removeRoom(room.key)}
                      />
                    </div>
                  ) : null}
                  <ul className="space-y-3">
                    {room.items.map((it) => {
                      const prev = before?.[it.key];
                      const itemPhotos = photosOf(it.key);
                      return (
                        <li key={it.key} className="rounded-[var(--radius-card)] border border-line bg-canvas/50 p-3">
                          <div className="flex items-start justify-between gap-2">
                            {readOnly ? (
                              <p className="text-sm font-semibold text-ink-950">{it.label}</p>
                            ) : (
                              <FormInput
                                aria-label="Kalem adı"
                                className="min-w-0 flex-1 bg-surface font-semibold"
                                value={it.label}
                                maxLength={80}
                                onChange={(e) => updateItem(room.key, it.key, { label: e.target.value })}
                              />
                            )}
                            {!readOnly ? <Button variant="ghost" size="icon" icon={X} aria-label={`${it.label} kalemini sil`} onClick={() => removeItem(room.key, it.key)} /> : null}
                          </div>
                          {prev ? (
                            <p className="mt-1 text-xs text-text-muted">
                              Teslimde: <span className="font-semibold">{CONDITION_LABELS[prev]}</span>
                            </p>
                          ) : null}
                          <div role="radiogroup" aria-label={`${it.label} durumu`} className="mt-2 grid grid-cols-4 gap-1.5">
                            {CONDITIONS.map((c) => (
                              <Button
                                key={c}
                                variant="secondary"
                                size="sm"
                                role="radio"
                                aria-checked={it.condition === c}
                                disabled={readOnly}
                                onClick={() => updateItem(room.key, it.key, { condition: c })}
                                className={cn("h-11 px-1 text-xs text-text-muted disabled:opacity-100", COND_STYLE[c])}
                              >
                                {CONDITION_LABELS[c]}
                              </Button>
                            ))}
                          </div>
                          {it.condition !== "good" || it.note ? (
                            readOnly ? (
                              it.note ? <p className="mt-2 text-sm text-ink-950">{it.note}</p> : null
                            ) : (
                              <FormInput
                                aria-label={`${it.label} notu`}
                                className="mt-2 bg-surface"
                                placeholder="Ne var? Örn. kapıda 10 cm çizik"
                                maxLength={500}
                                value={it.note}
                                onChange={(e) => updateItem(room.key, it.key, { note: e.target.value })}
                              />
                            )
                          ) : null}
                          {itemPhotos.length > 0 || !readOnly ? (
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              {itemPhotos.map((p) => (
                                <span key={p.id} className="relative">
                                  {p.url ? (
                                    <a href={p.url} target="_blank" rel="noopener noreferrer" className="focus-ring block rounded-[var(--radius-control)]">
                                      {/* eslint-disable-next-line @next/next/no-img-element -- kısa ömürlü imzalı özel kova URL'si; next/image önbelleğine girmemeli */}
                                      <img src={p.url} alt={`${it.label} fotoğrafı`} className="h-16 w-16 rounded-[var(--radius-control)] object-cover" loading="lazy" />
                                    </a>
                                  ) : (
                                    <span className="grid h-16 w-16 place-items-center rounded-[var(--radius-control)] bg-ink-950/8 text-xs text-text-muted">Foto</span>
                                  )}
                                  {!readOnly ? (
                                    <Button
                                      variant="secondary"
                                      size="icon"
                                      icon={X}
                                      aria-label="Fotoğrafı sil"
                                      onClick={() => void removePhoto(p.id)}
                                      className="absolute -right-3 -top-3 rounded-full shadow-[var(--shadow-xs)]"
                                    />
                                  ) : null}
                                </span>
                              ))}
                              {!readOnly ? (
                                <label className={cn("focus-within:ring-2 focus-within:ring-brand-400 inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-[var(--radius-control)] border border-dashed border-line-strong bg-surface px-3 text-xs font-semibold text-ink-950", uploading !== null && "pointer-events-none opacity-60")}>
                                  {uploading === it.key ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Camera className="h-4 w-4" aria-hidden="true" />}
                                  {uploading === it.key ? "Yükleniyor" : "Fotoğraf"}
                                  <input type="file" className="sr-only touch:min-h-11"
                                    accept="image/jpeg,image/png,image/webp"
                                    disabled={uploading !== null}
                                    onChange={(e) => {
                                      const f = e.target.files?.[0];
                                      e.target.value = "";
                                      void addPhoto(it.key, f);
                                    }}
                                  />
                                </label>
                              ) : null}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                  {!readOnly ? (
                    <Button variant="outline" size="sm" icon={Plus} onClick={() => addItem(room.key)}>Kalem ekle</Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {!readOnly ? (
        <div className="flex flex-wrap items-end gap-2 rounded-[var(--radius-panel)] border border-dashed border-line bg-surface p-3">
          <FormField label="Oda ekle" htmlFor="insp-new-room" className="min-w-0 flex-1">
            <FormInput value={newRoom} maxLength={80} placeholder="Örn. Çocuk odası" onChange={(e) => setNewRoom(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRoom(); } }} />
          </FormField>
          <Button variant="outline" icon={Plus} disabled={!newRoom.trim()} onClick={addRoom}>Ekle</Button>
        </div>
      ) : null}

      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
        <h2 className="font-display text-sm font-bold text-ink-950">Sayaçlar</h2>
        <div className="mt-3 space-y-3">
          {METER_KEYS.map((k) => (
            <div key={k} className="grid grid-cols-2 gap-2">
              <FormField label={`${METER_LABELS[k]} (${METER_UNITS[k]})`} htmlFor={`m-${k}`}>
                <FormInput inputMode="decimal" disabled={readOnly} value={meters[k].reading} placeholder="Okunan değer" onChange={(e) => { const v = e.target.value; setMeters((m) => ({ ...m, [k]: { ...m[k], reading: v } })); touch(); }} />
              </FormField>
              <FormField label="Abone / tesisat no" htmlFor={`s-${k}`}>
                <FormInput disabled={readOnly} value={meters[k].subscriber} onChange={(e) => { const v = e.target.value; setMeters((m) => ({ ...m, [k]: { ...m[k], subscriber: v } })); touch(); }} />
              </FormField>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
        <h2 className="flex items-center gap-2 font-display text-sm font-bold text-ink-950"><KeyRound className="h-4 w-4 text-brand-600" aria-hidden="true" /> Anahtarlar</h2>
        <ul className="mt-3 space-y-2">
          {keys.map((k, i) => (
            <li key={i} className="flex items-center gap-2">
              {readOnly ? (
                <span className="min-w-0 flex-1 text-sm text-ink-950">{k.label}</span>
              ) : (
                <FormInput aria-label="Anahtar türü" className="min-w-0 flex-1" value={k.label} maxLength={60} onChange={(e) => { const v = e.target.value; setKeys((ks) => ks.map((x, j) => (j === i ? { ...x, label: v } : x))); touch(); }} />
              )}
              {!readOnly ? <Button variant="outline" size="icon" icon={Minus} aria-label="Azalt" disabled={k.count <= 0} onClick={() => { setKeys((ks) => ks.map((x, j) => (j === i ? { ...x, count: Math.max(0, x.count - 1) } : x))); touch(); }} /> : null}
              <span className="numeric w-10 text-center text-sm font-bold text-ink-950" aria-label={`${k.count} adet`}>{k.count}</span>
              {!readOnly ? <Button variant="outline" size="icon" icon={Plus} aria-label="Artır" disabled={k.count >= 50} onClick={() => { setKeys((ks) => ks.map((x, j) => (j === i ? { ...x, count: Math.min(50, x.count + 1) } : x))); touch(); }} /> : null}
              {!readOnly ? <Button variant="ghost" size="icon" icon={Trash2} aria-label={`${k.label} satırını sil`} onClick={() => { setKeys((ks) => ks.filter((_, j) => j !== i)); touch(); }} /> : null}
            </li>
          ))}
        </ul>
        {!readOnly && keys.length < 12 ? (
          <Button className="mt-2" variant="outline" size="sm" icon={Plus} onClick={() => { setKeys((ks) => [...ks, { label: "Diğer anahtar", count: 1 }]); touch(); }}>Anahtar ekle</Button>
        ) : null}
      </section>

      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
        <FormField label="Genel notlar" htmlFor="insp-notes" hint="Demirbaşlar, teslim edilen beyaz eşya, özel durumlar.">
          <FormTextarea rows={3} maxLength={4000} disabled={readOnly} value={notes} onChange={(e) => { setNotes(e.target.value); touch(); }} />
        </FormField>
      </section>

      <div
        role="region"
        aria-label="Tutanak eylemleri"
        className="no-print sticky bottom-[calc(var(--mobile-nav-offset,0px)+0.5rem)] z-30 flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-2 shadow-[var(--elev-2)] lg:bottom-4"
      >
        {status === "draft" && canEdit ? (
          <>
            <Button variant="outline" icon={Save} loading={saveState.kind === "saving"} onClick={() => void persist()}>Kaydet</Button>
            <ConfirmDialog
              trigger={<Button icon={Lock} loading={pending} className="flex-1 sm:flex-none">Kesinleştir</Button>}
              title="Tutanağı kesinleştir"
              description="Kesinleşen tutanak değiştirilemez ve imzaya gönderilebilir. Gerekirse imzaya gitmeden önce taslağa geri alabilirsiniz."
              confirmLabel="Kesinleştir"
              tone="default"
              onConfirm={finalize}
            />
          </>
        ) : null}
        {status === "final" ? (
          <>
            {contractId && contractStatus && contractStatus !== "cancelled" && contractStatus !== "rejected" ? (
              <ButtonLink href={`/app/sozlesmeler/${contractId}`} icon={FileSignature} className="flex-1 sm:flex-none">
                {contractStatus === "signed" ? "İmzalı tutanak" : contractStatus === "sent" ? "İmza durumunu aç" : "İmzalayanları ekle"}
              </ButtonLink>
            ) : canEdit && canSign ? (
              <Button icon={FileSignature} loading={pending} className="flex-1 sm:flex-none" onClick={toSign}>İmzaya gönder</Button>
            ) : null}
            <PrintButton label="Yazdır" tone="outline" />
            {kind === "move_out" && !depositReturned ? (
              <ButtonLink href={`/app/kiralama/${rentalId}?sekme=teslim`} variant="outline" icon={Receipt}>Depozito kesintisi</ButtonLink>
            ) : null}
            {canEdit && !signLocked ? (
              <ConfirmDialog
                trigger={<Button variant="ghost" icon={RotateCcw}>Taslağa al</Button>}
                title="Tutanağı taslağa geri al"
                description="Tutanak yeniden düzenlenebilir olur; hazırlanmış imza taslağının bağı kaldırılır."
                confirmLabel="Taslağa al"
                tone="default"
                onConfirm={reopen}
              />
            ) : null}
          </>
        ) : null}
        {status === "draft" && !canEdit ? <span className="px-2 text-xs text-text-muted">Tutanağı yalnız düzenleme yetkisi olanlar değiştirebilir.</span> : null}
      </div>
    </div>
  );
}
