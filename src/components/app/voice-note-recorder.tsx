"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { extractVoiceNoteFields, getVoiceNoteAvailability, saveVoiceNote, transcribeVoiceNote, type VoiceNoteKind } from "@/app/actions/voice-note";
import type { NoteFieldSuggestions } from "@/lib/field-capture/note-fields";

/** Önerileri "Etiket: değer" satırlarına çevirir (özete eklenecek metin). */
function suggestionLines(f: NoteFieldSuggestions | null): { key: string; text: string; assumed: boolean }[] {
  if (!f) return [];
  const out: { key: string; text: string; assumed: boolean }[] = [];
  if (f.rooms) out.push({ key: "rooms", text: `Oda: ${f.rooms}`, assumed: false });
  if (f.budgetLabel) out.push({ key: "budget", text: `Bütçe: ${f.budgetLabel}`, assumed: false });
  if (f.region) out.push({ key: "region", text: `Bölge: ${f.region.label}`, assumed: false });
  if (f.appointment) out.push({ key: "appointment", text: `Randevu: ${f.appointment.label}`, assumed: f.appointment.assumed });
  if (f.nextTask) {
    out.push({
      key: "task",
      text: `Sonraki görev: ${f.nextTask.title}${f.nextTask.due ? ` (${f.nextTask.due.label})` : ""}`,
      assumed: Boolean(f.nextTask.due?.assumed),
    });
  }
  return out;
}
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/input";
import { VOICE_NOTE_MAX_SECONDS } from "@/lib/ai/voice-note";

/**
 * Sesli not -> AI özet. Ofis ayarı kapalıysa (varsayılan) hiç görünmez. Ses tarayıcıda MediaRecorder ile alınır, sunucuya
 * yalnız yazıya çevirmek için gider ve SAKLANMAZ; kullanıcı özeti/transkripti düzenleyip onaylayınca yalnız METİN not olarak kaydedilir.
 * Kayıttan önce ilgili kişinin açık rızası onay kutusuyla teyit edilir (KVKK).
 */
export function VoiceNoteRecorder({ kind, id }: { kind: VoiceNoteKind; id: string }) {
  const { push } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [consent, setConsent] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [summary, setSummary] = useState("");
  const [transcript, setTranscript] = useState("");
  const [draft, setDraft] = useState(false);
  const [fields, setFields] = useState<NoteFieldSuggestions | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let alive = true;
    void getVoiceNoteAvailability().then((r) => alive && setEnabled(r.enabled));
    return () => {
      alive = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  if (!enabled) return null;

  async function begin() {
    if (!consent) {
      push("Kayıttan önce açık rıza onayını işaretleyin", "err");
      return;
    }
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      push("Tarayıcınız ses kaydını desteklemiyor", "err");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { audioBitsPerSecond: 24_000 });
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
        upload(blob);
      };
      recorder.current = rec;
      rec.start();
      setSeconds(0);
      setRecording(true);
      timer.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= VOICE_NOTE_MAX_SECONDS) stop();
          return s + 1;
        });
      }, 1000);
    } catch {
      push("Mikrofon erişimi verilmedi", "err");
    }
  }

  function stop() {
    if (timer.current) clearInterval(timer.current);
    setRecording(false);
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
  }

  function upload(blob: Blob) {
    const fd = new FormData();
    fd.set("audio", blob, "kayit");
    fd.set("consent", "on");
    start(async () => {
      const res = await transcribeVoiceNote(fd);
      if (res.error) {
        push(res.error, "err");
        return;
      }
      setSummary(res.summary ?? "");
      setTranscript(res.transcript ?? "");
      setDraft(true);
      setAdded([]);
      if (!res.summary) push("Özet üretilemedi; transkripti düzenleyip kaydedebilirsiniz", "info");
      // Yapılandırılmış alan önerisi (bütçe/oda/bölge/randevu/görev): yalnız öneri, kullanıcı özete ekler.
      const extracted = res.transcript ? await extractVoiceNoteFields(res.transcript).catch(() => null) : null;
      setFields(extracted?.ok && extracted.fields ? extracted.fields : null);
    });
  }

  function save() {
    start(async () => {
      const res = await saveVoiceNote({ kind, id, summary, transcript });
      if (res.error) {
        push(res.error, "err");
        return;
      }
      push("Sesli not kaydedildi", "ok");
      setDraft(false);
      setSummary("");
      setTranscript("");
    });
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface p-4" aria-label="Sesli not">
      <p className="flex items-center gap-2 text-sm font-bold text-ink-950">
        <Mic className="h-4 w-4 text-brand-600" aria-hidden /> Sesli not (AI özeti)
      </p>
      <p className="mt-1 text-xs text-text-muted">Ses dosyası saklanmaz; yazıya çevrilip özetlenir, onayınızla yalnız metin not olarak kaydedilir.</p>
      {!draft ? (
        <div className="mt-3 space-y-2">
          <label className="flex items-start gap-2 text-xs text-ink-950">
            <Checkbox checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={recording || pending} />
            <span>İlgili kişinin ses kaydı ve yazıya çevrilmesi için açık rızası alındı (KVKK).</span>
          </label>
          {recording ? (
            <Button type="button" size="sm" variant="secondary" icon={Square} onClick={stop}>
              Durdur ({seconds} sn)
            </Button>
          ) : (
            <Button type="button" size="sm" variant="secondary" icon={pending ? Loader2 : Mic} loading={pending} onClick={begin}>
              {pending ? "İşleniyor" : "Kayda başla"}
            </Button>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <label className="block text-xs font-semibold text-ink-950">
            Özet (taslak, düzenleyebilirsiniz)
            <Textarea rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={1500} />
          </label>
          {suggestionLines(fields).length > 0 ? (
            <div className="rounded-[var(--radius-control)] border border-line bg-canvas p-2.5">
              <p className="mb-1.5 text-xs font-semibold text-text-muted">
                Konuşmadan çıkan bilgiler ({fields?.source === "kural+ai" ? "kural + AI" : "kural tabanlı"}) — onayladıklarınız özete eklenir
              </p>
              <ul className="space-y-1">
                {suggestionLines(fields).map((s) => (
                  <li key={s.key} className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold text-ink-950">{s.text}</span>
                    {s.assumed ? <span className="rounded-full bg-amber-400/20 px-2 py-0.5 font-semibold text-amber-700">varsayım</span> : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="ml-auto"
                      disabled={added.includes(s.key) || pending}
                      onClick={() => {
                        setSummary((prev) => [prev.trim(), `- ${s.text}`].filter(Boolean).join("\n").slice(0, 1500));
                        setAdded((a) => [...a, s.key]);
                      }}
                    >
                      {added.includes(s.key) ? "Eklendi" : "Özete ekle"}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <label className="block text-xs font-semibold text-ink-950">
            Transkript
            <Textarea rows={4} value={transcript} onChange={(e) => setTranscript(e.target.value)} maxLength={4000} />
          </label>
          <div className="flex gap-2">
            <Button type="button" size="sm" loading={pending} onClick={save}>
              Onayla ve not olarak kaydet
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(false)} disabled={pending}>
              Vazgeç
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
