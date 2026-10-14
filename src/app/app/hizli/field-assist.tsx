"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import Link from "@/components/ui/smart-link";
import { Button } from "@/components/ui/button";
import { CalendarClock, Check, CloudOff, ListChecks, Loader2, MapPin, Mic, MicOff, RotateCcw, Sparkles, Trash2, Wand2 } from "lucide-react";
import { now, toTrLocalInput } from "@/lib/clock";
import {
  browserStore,
  clearDraft,
  flushOutbox,
  formValues,
  loadDraft,
  OUTBOX_KEY,
  readOutbox,
  removeOutboxItem,
  saveDraft,
  type DraftValues,
  type OutboxItem,
  type SendOutcome,
} from "@/lib/field-capture/outbox";
import type { NoteFieldSuggestions } from "@/lib/field-capture/note-fields";
import type { GeoPointSuggestion } from "@/lib/geo/nearest";
import { extractQuickNoteFields, suggestQuickLocation } from "./actions";

/*
 * Saha yardımcıları (hızlı kayıt): yerel taslak, çevrimdışı kuyruk paneli, nottan alan önerisi (+ sesle yazma),
 * GPS'ten il/ilçe/mahalle önerisi. Hepsi ÖNERİ üretir; kayda yalnız kullanıcının uyguladığı değer gider.
 */

/** Onaylanmış öneri düğmesi vurgusu (kanonik Button üzerine). */
const APPLIED = "border-mint-500/50 bg-mint-500/10 text-mint-700";

/* --------------------------------- Taslak --------------------------------- */

// Sekme başına İLK okunan taslak (kararlı referans). Yazdıkça yalnız depo güncellenir; önbellek değişmez (form yeniden
// kurulmasın). Önbellek yalnız "temizle" ve "kuyruktan forma geri yükle" ile değişir → form yeni değerlerle yeniden kurulur.
const draftCache = new Map<string, DraftValues | null>();
const draftVersion = new Map<string, number>();
const draftListeners = new Set<() => void>();

function subscribeDrafts(cb: () => void) {
  draftListeners.add(cb);
  return () => draftListeners.delete(cb);
}

function setDraftCache(key: string, values: DraftValues | null) {
  draftCache.set(key, values);
  draftVersion.set(key, (draftVersion.get(key) ?? 0) + 1);
  draftListeners.forEach((l) => l());
}

function draftSnapshot(key: string): DraftValues | null {
  if (!draftCache.has(key)) draftCache.set(key, loadDraft(browserStore(), key, now()));
  return draftCache.get(key) ?? null;
}

/** Kuyruktan reddedilen kaydı ilgili sekmenin formuna geri yükler. */
export function restoreDraft(key: string, values: DraftValues) {
  saveDraft(browserStore(), key, values, now());
  setDraftCache(key, values);
}

/**
 * Formun yerel taslağı. `values` hidrasyondan sonra gelir (sunucuda null); `formKey` değişince form taslak
 * değerleriyle yeniden kurulur. `track` formun onInput'una bağlanır (gecikmeli kayıt).
 */
export function useFormDraft(key: string, skip: readonly string[] = []) {
  const values = useSyncExternalStore(subscribeDrafts, () => draftSnapshot(key), () => null);
  const version = useSyncExternalStore(subscribeDrafts, () => draftVersion.get(key) ?? 0, () => 0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function track(form: HTMLFormElement) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => saveDraft(browserStore(), key, formValues(form, ["client_request_id", ...skip]), now()), 400);
  }
  function clear() {
    if (timer.current) clearTimeout(timer.current);
    clearDraft(browserStore(), key);
    setDraftCache(key, null);
  }
  return { values, formKey: `${version}-${values ? "t" : "b"}`, track, clear, restored: Boolean(values) };
}

/* ---------------------------------- Kuyruk ---------------------------------- */

const outboxListeners = new Set<() => void>();
function notifyOutbox() {
  outboxListeners.forEach((l) => l());
}
function subscribeOutbox(cb: () => void) {
  outboxListeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === OUTBOX_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    outboxListeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}
function outboxRaw(): string {
  return browserStore()?.get(OUTBOX_KEY) ?? "";
}

export function useOutboxItems(): OutboxItem[] {
  const raw = useSyncExternalStore(subscribeOutbox, outboxRaw, () => "");
  // `raw` değişince yeniden okunur (depo dizesi kararlı ilkel değer).
  return useMemo(() => (raw ? readOutbox(browserStore()) : []), [raw]);
}

export function outboxChanged() {
  notifyOutbox();
}

export type OutboxSender = (item: OutboxItem) => Promise<SendOutcome>;

export type SentNotice = { id: string; label: string; href: string | null };

/**
 * Bekleyen kayıt paneli: bağlantı gelince (online olayı, sayfa açılışı, sekme görünür olunca) kuyruğu boşaltır.
 * Reddedilen kayıt "forma geri yükle" ile düzeltilip yeniden gönderilir.
 */
export function OutboxPanel({
  send,
  onRestore,
  hrefFor,
}: {
  send: OutboxSender;
  onRestore: (item: OutboxItem) => void;
  hrefFor: (item: OutboxItem, id?: string) => string | null;
}) {
  const items = useOutboxItems();
  const online = useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
  const [sent, setSent] = useState<SentNotice[]>([]);
  const [busy, setBusy] = useState(false);
  const pending = items.filter((i) => i.state === "pending");
  const failed = items.filter((i) => i.state === "failed");

  // Bağlantı geldiğinde / sayfa açılışında / sekme görünür olunca boşalt (tek uçuşlu: flushOutbox aynı sözü paylaşır).
  function flush() {
    if (!navigator.onLine || readOutbox(browserStore()).every((i) => i.state !== "pending")) return;
    setBusy(true);
    const ids = new Map<string, string | undefined>();
    void flushOutbox(browserStore(), async (item) => {
      const r = await send(item);
      if (r.kind === "ok") ids.set(item.id, r.id);
      return r;
    })
      .then((report) => {
        if (report.sent.length > 0) {
          setSent((prev) => [...report.sent.map((i) => ({ id: i.id, label: i.label, href: hrefFor(i, ids.get(i.id)) })), ...prev].slice(0, 5));
        }
      })
      .finally(() => {
        setBusy(false);
        notifyOutbox();
      });
  }
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  useEffect(() => {
    const run = () => {
      if (document.visibilityState !== "hidden") flushRef.current();
    };
    window.addEventListener("online", run);
    document.addEventListener("visibilitychange", run);
    const t = setTimeout(run, 300);
    return () => {
      clearTimeout(t);
      window.removeEventListener("online", run);
      document.removeEventListener("visibilitychange", run);
    };
  }, []);

  if (items.length === 0 && sent.length === 0 && online) return null;
  return (
    <section aria-label="Bekleyen kayıtlar" className="rounded-[var(--radius-panel)] border border-line bg-surface p-3 text-sm">
      {!online ? (
        <p className="flex items-center gap-2 font-semibold text-amber-700">
          <CloudOff className="h-4 w-4" aria-hidden /> Bağlantı yok. Kayıtlar bu cihazda sıraya alınır, bağlantı gelince bir kez gönderilir.
        </p>
      ) : null}
      {pending.length > 0 ? (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 font-semibold text-ink-950">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ListChecks className="h-4 w-4" aria-hidden />}
            {pending.length} kayıt gönderilmeyi bekliyor
          </span>
          {online && !busy ? (
            <Button variant="secondary" size="sm" onClick={flush}>
              Şimdi gönder
            </Button>
          ) : null}
        </div>
      ) : null}
      {failed.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {failed.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-danger-400/40 bg-danger-500/8 px-2.5 py-2 text-xs">
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-ink-950">{i.label}</span>
                <span className="block text-danger-600">{i.lastError ?? "Gönderilemedi."}</span>
              </span>
              <Button variant="secondary" size="sm" icon={RotateCcw} onClick={() => onRestore(i)}>
                Forma geri yükle
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={Trash2}
                onClick={() => {
                  removeOutboxItem(browserStore(), i.id);
                  notifyOutbox();
                }}
                className="text-danger-600"
                aria-label={`${i.label} kaydını sil`}
              >
                Sil
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {sent.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {sent.map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-xs text-mint-700">
              <Check className="h-3.5 w-3.5" aria-hidden /> Gönderildi: {s.label}
              {s.href ? (
                <Link href={s.href} className="font-semibold underline underline-offset-2">
                  Kaydı aç
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/* --------------------------- Nottan alan önerisi --------------------------- */

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
};

function speechCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Kontrolsüz textarea'ya metin ekler ve input olayı yayar (taslak kaydı tetiklensin). */
function appendToField(el: HTMLTextAreaElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  const next = [el.value.trim(), text.trim()].filter(Boolean).join(el.value.trim() ? " " : "");
  setter?.call(el, next);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

type Approvals = { rooms: boolean; budget: boolean; region: boolean; task: boolean; appointment: boolean };
const NO_APPROVALS: Approvals = { rooms: false, budget: false, region: false, task: false, appointment: false };

/**
 * Not alanının altındaki yardımcı: "Sesle yaz" (tarayıcının konuşma tanıması) + "Nottan alanları çıkar". Öneriler tek tek
 * "Uygula" ile onaylanır; onaylananlar gizli `fx_*` alanlarıyla forma girer (sunucu talep/görev açar). Randevu önerisi
 * kayıttan sonra randevu sekmesini ön doldurmak için `fx_appt_at` taşır.
 */
export function NoteAssist({
  textareaId,
  demand,
  task = true,
}: {
  textareaId: string;
  /** Bütçe/oda/bölge önerisi talep olarak uygulanabilir mi (alıcı/kiracı tarafı). */
  demand: boolean;
  task?: boolean;
}) {
  const [fields, setFields] = useState<NoteFieldSuggestions | null>(null);
  const [aiState, setAiState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState<Approvals>(NO_APPROVALS);
  const [listening, setListening] = useState(false);
  const [pending, start] = useTransition();
  const rec = useRef<SpeechRecognitionLike | null>(null);

  function field(): HTMLTextAreaElement | null {
    const el = document.getElementById(textareaId);
    return el instanceof HTMLTextAreaElement ? el : null;
  }

  function toggleDictation() {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const Ctor = speechCtor();
    if (!Ctor) {
      setError("Bu tarayıcı sesle yazmayı desteklemiyor; klavyedeki mikrofon düğmesini kullanabilirsiniz.");
      return;
    }
    setError(null);
    const r = new Ctor();
    r.lang = "tr-TR";
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      const el = field();
      if (!el) return;
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const res = e.results[i];
        if (res.isFinal && res[0]?.transcript) appendToField(el, res[0].transcript);
      }
    };
    r.onend = () => setListening(false);
    r.onerror = () => {
      setListening(false);
      setError("Ses alınamadı (mikrofon izni ya da bağlantı). Notu yazarak da girebilirsiniz.");
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }

  function extract() {
    const text = field()?.value ?? "";
    if (!text.trim()) {
      setError("Önce notu yazın ya da söyleyin.");
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setError("Bağlantı yokken öneri çıkarılamaz; not olduğu gibi kaydedilir.");
      return;
    }
    setError(null);
    start(async () => {
      try {
        const r = await extractQuickNoteFields(text);
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setFields(r.fields);
        setApproved(NO_APPROVALS);
        setAiState(r.ai === "kullanildi" && r.fields.source === "kural+ai" ? "Eksikler AI ile tamamlandı" : r.ai === "hata" ? "AI şu an yanıt vermedi; kural tabanlı öneriler" : null);
      } catch {
        setError("Öneriler şu an alınamadı.");
      }
    });
  }

  const f = fields;
  const rows: { key: keyof Approvals; icon: typeof Sparkles; label: string; value: string; note?: string }[] = [];
  if (f && demand) {
    if (f.rooms) rows.push({ key: "rooms", icon: Sparkles, label: "Oda", value: f.rooms });
    if (f.budgetLabel) rows.push({ key: "budget", icon: Sparkles, label: "Bütçe", value: f.budgetLabel });
    if (f.region) rows.push({ key: "region", icon: MapPin, label: "Bölge", value: f.region.label });
  }
  if (f?.appointment) {
    rows.push({ key: "appointment", icon: CalendarClock, label: "Randevu", value: f.appointment.label, note: f.appointment.assumed ? "saat/gün varsayım" : undefined });
  }
  if (f?.nextTask && task) {
    rows.push({
      key: "task",
      icon: ListChecks,
      label: "Sonraki görev",
      value: f.nextTask.title + (f.nextTask.due ? ` · ${f.nextTask.due.label}` : ""),
      note: f.nextTask.due?.assumed ? "saat varsayım" : undefined,
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={listening ? MicOff : Mic}
          aria-pressed={listening}
          onClick={toggleDictation}
          className={listening ? "border-danger-400 text-danger-600" : undefined}
        >
          {listening ? "Dinlemeyi durdur" : "Sesle yaz"}
        </Button>
        <Button variant="secondary" size="sm" icon={Wand2} loading={pending} onClick={extract}>
          Nottan alanları çıkar
        </Button>
        {listening ? <span className="text-xs text-text-muted">Dinleniyor… konuştukça not alanına eklenir.</span> : null}
      </div>
      {error ? <p className="text-xs font-medium text-danger-600">{error}</p> : null}
      {f && rows.length === 0 ? <p className="text-xs text-text-muted">Notta bütçe, oda, bölge, tarih ya da görev bulunamadı.</p> : null}
      {rows.length > 0 ? (
        <div className="rounded-[var(--radius-control)] border border-line bg-canvas p-2.5">
          <p className="mb-1.5 text-xs font-semibold text-text-muted">
            Öneriler ({f?.source === "kural+ai" ? "kural + AI" : "kural tabanlı"}) — yalnız uyguladıklarınız kaydedilir{aiState ? ` · ${aiState}` : ""}
          </p>
          <ul className="space-y-1.5">
            {rows.map((r) => {
              const on = approved[r.key];
              return (
                <li key={r.key} className="flex flex-wrap items-center gap-2 text-sm">
                  <r.icon className="h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden />
                  <span className="text-text-muted">{r.label}:</span>
                  <span className="font-semibold text-ink-950">{r.value}</span>
                  {r.note ? <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-xs font-semibold text-amber-700">{r.note}</span> : null}
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={on ? Check : undefined}
                    aria-pressed={on}
                    onClick={() => setApproved((a) => ({ ...a, [r.key]: !a[r.key] }))}
                    className={`ml-auto ${on ? APPLIED : ""}`}
                  >
                    {on ? "Uygulandı" : "Uygula"}
                  </Button>
                </li>
              );
            })}
          </ul>
          {approved.rooms || approved.budget || approved.region ? (
            <p className="mt-1.5 text-xs text-text-muted">Kayıtla birlikte bu kriterlerle bir talep açılır.</p>
          ) : null}
          {approved.appointment ? <p className="mt-1 text-xs text-text-muted">Kayıttan sonra randevu bu saatle ön doldurulur; siz onaylarsınız.</p> : null}
        </div>
      ) : null}
      {/* Onaylanan öneriler (sunucu yalnız bunları uygular) */}
      {f && approved.rooms && f.rooms ? <input type="hidden" name="fx_rooms" value={f.rooms} /> : null}
      {f && approved.budget && f.budgetMin != null ? <input type="hidden" name="fx_budget_min" value={String(f.budgetMin)} /> : null}
      {f && approved.budget && f.budgetMax != null ? <input type="hidden" name="fx_budget_max" value={String(f.budgetMax)} /> : null}
      {f && approved.region && f.region?.provinceId ? <input type="hidden" name="fx_province_id" value={f.region.provinceId} /> : null}
      {f && approved.region && f.region?.districtId ? <input type="hidden" name="fx_district_id" value={f.region.districtId} /> : null}
      {f && approved.region && f.region?.neighborhoodId ? <input type="hidden" name="fx_neighborhood_id" value={f.region.neighborhoodId} /> : null}
      {f && approved.task && f.nextTask ? <input type="hidden" name="fx_task_title" value={f.nextTask.title} /> : null}
      {f && approved.task && f.nextTask?.due ? <input type="hidden" name="fx_task_due" value={toTrLocalInput(f.nextTask.due.iso)} /> : null}
      {f && approved.appointment && f.appointment ? <input type="hidden" name="fx_appt_at" value={toTrLocalInput(f.appointment.iso)} /> : null}
    </div>
  );
}

/* ---------------------------- GPS konum önerisi ---------------------------- */

const SOURCE_LABEL: Record<GeoPointSuggestion["source"], string> = {
  mahalle: "en yakın mahalle",
  portfoy: "yakındaki portföyünüzün konumu",
  ilce: "en yakın ilçe merkezi",
  il: "yalnız il (yakında ilçe verisi yok)",
};

/**
 * Konum alınınca il/ilçe/mahalle önerisi; "Uygula" ile gizli alanlar dolar ve adres boşsa "Mahalle, İlçe / İl" yazılır.
 * `point` değişince (yeni konum) öneri yeniden istenir — istek olay yöneticisinden (konum alındığında) tetiklenir.
 */
export function useLocationSuggestion() {
  const [suggestion, setSuggestion] = useState<GeoPointSuggestion | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "none" | "error">("idle");
  const [applied, setApplied] = useState(false);
  const seq = useRef(0);
  function request(lat: number, lng: number) {
    const mine = ++seq.current;
    setApplied(false);
    setSuggestion(null);
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setState("none");
      return;
    }
    setState("busy");
    suggestQuickLocation(lat, lng)
      .then((r) => {
        if (mine !== seq.current) return;
        if (!r.ok) setState("error");
        else if (!r.suggestion) setState("none");
        else {
          setSuggestion(r.suggestion);
          setState("idle");
        }
      })
      .catch(() => mine === seq.current && setState("error"));
  }
  function reset() {
    seq.current += 1;
    setSuggestion(null);
    setApplied(false);
    setState("idle");
  }
  return { suggestion, state, applied, setApplied, request, reset };
}

export function LocationSuggestionRow({
  loc,
  addressInputId,
}: {
  loc: ReturnType<typeof useLocationSuggestion>;
  addressInputId: string;
}) {
  const s = loc.suggestion;
  if (loc.state === "busy") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-text-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Konuma göre il/ilçe/mahalle aranıyor…
      </p>
    );
  }
  if (loc.state === "none") return <p className="text-xs text-text-muted">Bu konum için il/ilçe/mahalle önerisi yok; adresi yazabilirsiniz.</p>;
  if (loc.state === "error") return <p className="text-xs text-danger-600">Konum önerisi alınamadı; adresi yazabilirsiniz.</p>;
  if (!s) return null;
  function apply() {
    if (!s) return;
    loc.setApplied(true);
    const el = document.getElementById(addressInputId);
    if (el instanceof HTMLInputElement && !el.value.trim()) {
      const text = [s.neighborhoodName ? `${s.neighborhoodName} Mah.` : null, [s.districtName, s.provinceName].filter(Boolean).join(" / ")]
        .filter(Boolean)
        .join(", ");
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-2 text-sm">
      <MapPin className="h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="font-semibold text-ink-950">{s.label}</span>
        <span className="block text-xs text-text-muted">
          Öneri: {SOURCE_LABEL[s.source]} (~{s.distanceKm.toLocaleString("tr-TR")} km). Doğruysa uygulayın.
        </span>
      </span>
      <Button
        variant="secondary"
        size="sm"
        icon={loc.applied ? Check : undefined}
        aria-pressed={loc.applied}
        onClick={() => (loc.applied ? loc.setApplied(false) : apply())}
        className={loc.applied ? APPLIED : undefined}
      >
        {loc.applied ? "Uygulandı" : "Uygula"}
      </Button>
      {loc.applied && s.provinceId ? <input type="hidden" name="province_id" value={s.provinceId} /> : null}
      {loc.applied && s.districtId ? <input type="hidden" name="district_id" value={s.districtId} /> : null}
      {loc.applied && s.neighborhoodId ? <input type="hidden" name="neighborhood_id" value={s.neighborhoodId} /> : null}
    </div>
  );
}
