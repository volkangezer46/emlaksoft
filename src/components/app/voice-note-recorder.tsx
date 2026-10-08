"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { getVoiceNoteAvailability, saveVoiceNote, transcribeVoiceNote, type VoiceNoteKind } from "@/app/actions/voice-note";
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
      if (!res.summary) push("Özet üretilemedi; transkripti düzenleyip kaydedebilirsiniz", "info");
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
