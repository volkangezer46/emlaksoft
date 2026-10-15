"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Flame, Gauge, KeyRound, Loader2, ShieldCheck, XCircle } from "lucide-react";
import {
  purgeAndWarmAll,
  runCompressionTest,
  runLab,
  runStaticSelfTest,
  savePsiKey,
  setStaticRoute,
  type SelfTestRow,
} from "@/app/actions/speed-admin";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

/**
 * HIZ MERKEZİ istemci parçaları. Veri yalnız server action'lardan gelir; sunucu modülü içe aktarılmaz.
 * Her eylem `useTransition` ile anında görsel tepki verir (HIZ ilkesi), sonuç satır satır gösterilir.
 */

type Note = { tone: "ok" | "err"; text: string } | null;

function NoteLine({ note }: { note: Note }) {
  if (!note) return null;
  return (
    <p role="status" className={`flex items-start gap-1.5 text-xs ${note.tone === "ok" ? "text-mint-700" : "text-danger-700"}`}>
      {note.tone === "ok" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      {note.text}
    </p>
  );
}

const kb = (b: number | null) => (b === null ? "—" : `${(b / 1024).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} KB`);

/** Statik/Normal anahtarı (yalnız süper admin değiştirebilir; diğerleri salt okur). */
export function StaticRouteSwitch({ id, label, enabled, canToggle }: { id: string; label: string; enabled: boolean; canToggle: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<Note>(null);
  return (
    <div className="space-y-1">
      <span className="flex items-center gap-2">
        <Switch
          checked={on}
          disabled={!canToggle || pending}
          aria-label={`${label}: statik sunum`}
          onCheckedChange={(next) => {
            setOn(next);
            setNote(null);
            start(async () => {
              const r = await setStaticRoute({ id, enabled: next });
              if (!r.ok) setOn(!next);
              setNote(r.ok ? { tone: "ok", text: r.message } : { tone: "err", text: r.error });
              if (r.ok) router.refresh();
            });
          }}
        />
        <span className="text-xs font-bold text-ink-950">{on ? "Statik" : "Normal"}</span>
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin text-text-faint" aria-hidden="true" /> : null}
      </span>
      <NoteLine note={note} />
    </div>
  );
}

/** "Tümünü temizle ve ısıt" (operasyon ve üstü; dakikada 1). */
export function PurgeWarmButton({ labels }: { labels: Record<string, string> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<Note>(null);
  const [rows, setRows] = useState<Array<{ id: string; ok: boolean; isStatic: boolean | null; ms: number; gzipBytes: number | null; error?: string }>>([]);
  return (
    <div className="space-y-3">
      <Button
        variant="outline"
        size="sm"
        loading={pending}
        icon={Flame}
        onClick={() => {
          setNote(null);
          setRows([]);
          start(async () => {
            const r = await purgeAndWarmAll();
            setNote(r.ok ? { tone: "ok", text: r.message } : { tone: "err", text: r.error });
            if (r.ok) {
              setRows(r.data ?? []);
              router.refresh();
            }
          });
        }}
      >
        Tümünü temizle ve ısıt
      </Button>
      <NoteLine note={note} />
      {rows.length ? (
        <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line text-sm" aria-label="Isıtma sonuçları">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="font-semibold text-ink-950">{labels[r.id] ?? r.id}</span>
              <span className={`text-xs ${r.ok && r.isStatic ? "text-mint-700" : "text-danger-700"}`}>
                {r.ok ? (r.isStatic ? `Statik · ${kb(r.gzipBytes)} gzip · ${r.ms} ms` : `Normal sürüme düştü · ${r.ms} ms`) : `Hata: ${r.error ?? "bilinmiyor"}`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** X-Static öz testi: her kayıt yolu belge isteği olarak çekilir; başlık ve Next betik sayısı gösterilir. */
export function SelfTestPanel() {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<Note>(null);
  const [rows, setRows] = useState<SelfTestRow[]>([]);
  return (
    <div className="space-y-3">
      <Button
        variant="outline"
        size="sm"
        loading={pending}
        icon={ShieldCheck}
        onClick={() => {
          setNote(null);
          start(async () => {
            const r = await runStaticSelfTest();
            if (r.ok) setRows(r.data ?? []);
            else setNote({ tone: "err", text: r.error });
          });
        }}
      >
        X-Static öz testini çalıştır
      </Button>
      <NoteLine note={note} />
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="adm-tbl-m w-full md:min-w-[34rem] text-left text-sm">
            <thead className="text-xs text-text-faint">
              <tr>
                <th className="py-1.5 pr-3 font-bold">Yol</th>
                <th className="py-1.5 pr-3 font-bold">HTTP</th>
                <th className="py-1.5 pr-3 font-bold">X-Static</th>
                <th className="py-1.5 pr-3 font-bold">Next betiği</th>
                <th className="py-1.5 font-bold">Boyut (gzip / ham)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-1.5 pr-3 font-mono text-xs text-ink-950">{r.path}</td>
                  <td data-label="HTTP" className="py-1.5 pr-3">{r.status ?? "—"}</td>
                  <td data-label="X-Static" className={`py-1.5 pr-3 font-bold ${r.xStatic === "1" ? "text-mint-700" : r.xStatic === "fallback" ? "text-danger-700" : "text-text-muted"}`}>
                    {r.xStatic === "1" ? "1 (statik)" : r.xStatic === "fallback" ? "yedek" : "yok (normal)"}
                  </td>
                  <td data-label="Next betiği" className="py-1.5 pr-3">{r.nextScripts ?? "—"}</td>
                  <td data-label="Boyut (gzip / ham)" className="py-1.5">{r.error ? <span className="text-danger-700">{r.error}</span> : `${kb(r.gzipBytes)} / ${kb(r.rawBytes)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/** Sıkıştırma öz testi (`accept-encoding: br`). */
export function CompressionTestButton() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ label: string; tone: "ok" | "warn" | "bad" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const TONE = { ok: "text-mint-700", warn: "text-amber-900", bad: "text-danger-700" } as const;
  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        size="sm"
        loading={pending}
        icon={Gauge}
        onClick={() => {
          setError(null);
          start(async () => {
            const r = await runCompressionTest();
            if (r.ok && r.data) setResult({ label: r.data.label, tone: r.data.tone });
            else if (!r.ok) setError(r.error);
          });
        }}
      >
        Sıkıştırmayı sına
      </Button>
      {result ? <p className={`text-sm font-bold ${TONE[result.tone]}`}>{result.label}</p> : null}
      {error ? <p className="text-xs text-danger-700">{error}</p> : null}
    </div>
  );
}

/** Laboratuvar: tek yol için PSI mobil + masaüstü. */
export function LabRunButton({ path }: { path: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<Note>(null);
  return (
    <div className="space-y-1">
      <Button
        variant="outline"
        size="xs"
        loading={pending}
        onClick={() => {
          setNote(null);
          start(async () => {
            const r = await runLab({ path });
            setNote(r.ok ? { tone: "ok", text: r.message } : { tone: "err", text: r.error });
            router.refresh();
          });
        }}
      >
        {pending ? "Ölçülüyor (≈1 dk)…" : "Ölç"}
      </Button>
      <NoteLine note={note} />
    </div>
  );
}

/** PageSpeed API anahtarı (süper admin). Değer geri gösterilmez; boş kaydetmek siler. */
export function PsiKeyForm({ configured, canWrite }: { configured: boolean; canWrite: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState("");
  const [note, setNote] = useState<Note>(null);
  if (!canWrite) {
    return <p className="text-sm text-text-muted">{configured ? "Anahtar tanımlı (yalnız süper admin değiştirebilir)." : "Anahtar yok; süper admin ekleyebilir."}</p>;
  }
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        setNote(null);
        start(async () => {
          const r = await savePsiKey({ key: value });
          setNote(r.ok ? { tone: "ok", text: r.message } : { tone: "err", text: r.error });
          if (r.ok) {
            setValue("");
            router.refresh();
          }
        });
      }}
    >
      <label className="flex-1 space-y-1 text-sm">
        <span className="font-bold text-ink-950">PageSpeed API anahtarı</span>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={configured ? "Tanımlı — değiştirmek için yeni anahtarı yapıştırın (boş = sil)" : "AIza… (Google Cloud > PageSpeed Insights API)"}
          className="focus-ring h-10 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 font-mono text-sm touch:h-11"
        />
      </label>
      <Button type="submit" variant="navy" size="sm" loading={pending} icon={KeyRound}>
        {value.trim() === "" && configured ? "Anahtarı sil" : "Kaydet"}
      </Button>
      <NoteLine note={note} />
    </form>
  );
}
