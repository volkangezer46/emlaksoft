"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, CircleDashed, EyeOff, Loader2, Play, Rocket, ScanSearch, Sparkles, Wand2, XCircle } from "lucide-react";
import {
  applyFixes,
  ignoreIssue,
  prepareSafeFixes,
  previewAllDrafts,
  publishAllDrafts,
  recheckLive,
  runSiteAudit,
  setAutopilot,
  type AllDraftsPreview,
  type ApplyRow,
  type PlanRow,
} from "@/app/actions/optimizer";
import type { PublishAllItem } from "@/lib/site-issues/publish-all";
import type { SyncStep } from "@/lib/site-issues/collectors";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { FormField, FormTextarea } from "@/components/ui/form-controls";
import { Switch } from "@/components/ui/switch";

/**
 * KOKPİT istemci parçaları: denetim (satır satır ilerleme), güvenli düzeltme hazırlığı (kuru çalışma → seçim → uygula),
 * kuyruk satırı eylemleri, Otopilot anahtarı, toplu yayın ve canlı doğrulamayı yeniden deneme. Veri yalnız server
 * action'lardan gelir; sayfa `useTransition` + `router.refresh()` ile güncellenir.
 */

type Line = { id: string; label: string; state: "bekliyor" | "calisiyor" | "tamam" | "hata" | "arkada"; message?: string };

/** "Siteyi şimdi denetle": toplayıcılar sırayla çağrılır, her biri bir satır olarak ilerler. */
export function AuditButton({ collectors }: { collectors: { id: string; label: string }[] }) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>([]);
  const [running, setRunning] = useState(false);
  const [, startTransition] = useTransition();

  const update = (id: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const run = async () => {
    setRunning(true);
    setLines(collectors.map((c) => ({ id: c.id, label: c.label, state: "bekliyor" })));
    for (const c of collectors) {
      update(c.id, { state: "calisiyor" });
      try {
        const res = await runSiteAudit({ collector: c.id });
        const step: SyncStep | undefined = res.steps?.[0];
        if (res.error || !step) update(c.id, { state: "hata", message: res.error ?? "Sonuç alınamadı." });
        else update(c.id, { state: step.pending ? "arkada" : step.ok ? "tamam" : "hata", message: step.message });
      } catch {
        update(c.id, { state: "hata", message: "Bağlantı hatası." });
      }
      startTransition(() => router.refresh());
    }
    setRunning(false);
  };

  return (
    <div className="space-y-2">
      <Button icon={ScanSearch} loading={running} onClick={() => void run()} disabled={running || collectors.length === 0}>
        Siteyi şimdi denetle
      </Button>
      {lines.length ? (
        <ol className="space-y-1 text-sm" aria-live="polite">
          {lines.map((l) => (
            <li key={l.id} className="flex items-start gap-2">
              {l.state === "calisiyor" ? (
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-brand-600" aria-hidden="true" />
              ) : l.state === "tamam" ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-mint-700" aria-hidden="true" />
              ) : l.state === "hata" ? (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger-700" aria-hidden="true" />
              ) : (
                <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-text-faint" aria-hidden="true" />
              )}
              <span>
                <span className="font-semibold text-ink-950">{l.label}</span>
                {l.message ? <span className="text-text-muted"> · {l.message}</span> : l.state === "bekliyor" ? <span className="text-text-faint"> · sırada</span> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function BeforeAfter({ before, after }: { before: string | null; after: string | null }) {
  if (!before && !after) return null;
  return (
    <span className="mt-1 grid gap-1 text-xs sm:grid-cols-2">
      <span className="rounded-[var(--radius-control)] bg-danger-500/5 p-1.5 text-text-muted">Önce: {before ?? "—"}</span>
      <span className="rounded-[var(--radius-control)] bg-mint-500/10 p-1.5 text-ink-950">Sonra: {after ?? "—"}</span>
    </span>
  );
}

/** "Güvenli düzeltmeleri hazırla": önce kuru çalışma (plan), sonra seçilenler için uygula; sonuç kartında önce/sonra. */
export function SafeFixesButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [plans, setPlans] = useState<PlanRow[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<ApplyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const openDry = () => {
    setOpen(true);
    setPlans(null);
    setResults(null);
    setError(null);
    startTransition(async () => {
      const res = await prepareSafeFixes(true);
      if (res.error) setError(res.error);
      setPlans(res.plans ?? []);
      setPicked(new Set((res.plans ?? []).map((p) => p.issueId)));
    });
  };

  const apply = () =>
    startTransition(async () => {
      const res = await applyFixes([...picked]);
      if (res.error) {
        setError(res.error);
        return;
      }
      setResults(res.applied ?? []);
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" icon={Wand2} onClick={openDry}>
        Güvenli düzeltmeleri hazırla
      </Button>
      <DialogContent size="lg">
        <DialogHeader icon={<Wand2 />} title="Güvenli düzeltmeler" description="Önce kuru çalışma: hiçbir şey değişmeden ne yapılacağı listelenir. Onayladıklarınız taslağa alınır; yayın ayrıca yapılır." />
        <DialogBody className="space-y-3">
          {plans === null ? (
            <p className="flex items-center gap-2 text-sm text-text-muted">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Hazırlanabilecek düzeltmeler aranıyor…
            </p>
          ) : results ? (
            <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line" aria-label="Sonuçlar">
              {results.map((r) => (
                <li key={r.issueId} className="p-3 text-sm">
                  <span className={`font-semibold ${r.ok ? "text-mint-700" : "text-danger-700"}`}>{r.ok ? "Taslağa alındı" : "Yapılamadı"}</span>
                  <span className="text-text-muted"> · {r.target} · {r.message}</span>
                  <BeforeAfter before={r.before} after={r.after} />
                </li>
              ))}
            </ul>
          ) : plans.length === 0 ? (
            <p className="text-sm text-text-muted">
              Şu an otomatik hazırlanabilecek güvenli düzeltme yok. Kuyruktaki bulgular &quot;Düzelt&quot; bağlantısıyla ilgili ekranda düzeltilir; yeni düzeltme türleri bağlandıkça burada listelenir.
            </p>
          ) : (
            <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line" aria-label="Önerilen düzeltmeler">
              {plans.map((p) => (
                <li key={p.issueId} className="flex gap-3 p-3 text-sm">
                  <Checkbox
                    checked={picked.has(p.issueId)}
                    aria-label={p.summary}
                    onChange={(e) => {
                      const next = new Set(picked);
                      if (e.target.checked) next.add(p.issueId);
                      else next.delete(p.issueId);
                      setPicked(next);
                    }}
                  />
                  <span className="min-w-0">
                    <span className="font-semibold text-ink-950">{p.summary}</span>
                    <BeforeAfter before={p.before} after={p.after} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          {error ? <p role="alert" className="text-sm font-semibold text-danger-700">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Kapat</Button>
          {plans && plans.length > 0 && !results ? (
            <Button icon={Sparkles} loading={pending} disabled={picked.size === 0} onClick={apply}>
              Seçilenleri taslağa al ({picked.size})
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Kuyruk satırı: "Taslağa al" (yürütücü) ve "Yoksay" (gerekçe zorunlu). */
export function IssueRowActions({ id, canDraft, title }: { id: string; canDraft: boolean; title: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const uid = useId();

  const draft = () =>
    startTransition(async () => {
      setError(null);
      const res = await applyFixes([id]);
      if (res.error) setError(res.error);
      else setNote(res.applied?.[0]?.message ?? "Taslağa alındı.");
      router.refresh();
    });

  const ignore = () =>
    startTransition(async () => {
      const res = await ignoreIssue(id, reason);
      if (res.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setReason("");
      router.refresh();
    });

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {canDraft ? (
        <Button size="sm" variant="outline" icon={Sparkles} loading={pending && !open} onClick={draft}>
          Taslağa al
        </Button>
      ) : null}
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setError(null);
        }}
      >
        <Button size="sm" variant="ghost" icon={EyeOff} onClick={() => setOpen(true)}>
          Yoksay
        </Button>
        <DialogContent size="md">
          <DialogHeader icon={<EyeOff />} title="Bulguyu yoksay" description={title} />
          <DialogBody className="space-y-3">
            <FormField label="Gerekçe" htmlFor={`${uid}-r`} required hint="Ör. Bu sayfa bilerek kısa tutuldu. Gerekçe denetim izine yazılır.">
              <FormTextarea id={`${uid}-r`} value={reason} maxLength={240} rows={3} onChange={(e) => setReason(e.target.value)} />
            </FormField>
            {error ? <p role="alert" className="text-sm font-semibold text-danger-700">{error}</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Vazgeç</Button>
            <Button icon={EyeOff} loading={pending} disabled={reason.trim().length < 5} onClick={ignore}>
              Yoksay
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {note ? <span role="status" className="text-xs text-mint-700">{note}</span> : null}
      {error && !open ? <span role="alert" className="text-xs text-danger-700">{error}</span> : null}
    </span>
  );
}

/** Otopilot anahtarı (yalnız süper admin görür): açarken ne yapacağı listelenir. */
export function AutopilotSwitch({ enabled, publish, kinds }: { enabled: boolean; publish: boolean; kinds: { id: string; label: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [withPublish, setWithPublish] = useState(publish);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = (next: boolean) =>
    startTransition(async () => {
      setError(null);
      const res = await setAutopilot({ enabled: next, publish: withPublish });
      if (res.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Switch checked={enabled} aria-label="Otopilot" disabled={pending} onCheckedChange={(next) => (next ? setOpen(true) : save(false))} />
      {error ? <span role="alert" className="text-xs text-danger-700">{error}</span> : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md">
          <DialogHeader icon={<Play />} title="Otopilot açılsın mı?" description="Her gece yalnız güvenli ve aşağıdaki türdeki düzeltmeleri kendisi hazırlar. Her işlem kayda geçer." />
          <DialogBody className="space-y-3">
            <ul className="list-disc space-y-1 pl-5 text-sm text-ink-950">
              {kinds.map((k) => (
                <li key={k.id}>{k.label}</li>
              ))}
            </ul>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={withPublish} onChange={(e) => setWithPublish(e.target.checked)} />
              <span>Hazırlanan taslakları Yayın masası üzerinden kendisi yayınlasın (kapalıyken taslaklar onayınızı bekler).</span>
            </label>
            <p className="flex gap-2 rounded-[var(--radius-control)] bg-amber-100 p-3 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              Gece çalışması zamanlanmış görev bağlandığında başlar; o zamana kadar ayar saklanır ve hiçbir değişiklik yapılmaz.
            </p>
            {error ? <p role="alert" className="text-sm font-semibold text-danger-700">{error}</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Vazgeç</Button>
            <Button icon={Play} loading={pending} onClick={() => save(true)}>Otopilotu aç</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </span>
  );
}

/** "Taslakları önizle ve tümünü yayınla" (yalnız süper admin): tek liste fark, tek onay, yüzey başına sonuç. */
export function PublishAllButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<AllDraftsPreview | null>(null);
  const [items, setItems] = useState<PublishAllItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const show = () => {
    setOpen(true);
    setPreview(null);
    setItems(null);
    setError(null);
    void previewAllDrafts().then(setPreview, () => setPreview({ error: "Farklar alınamadı." }));
  };

  const publish = () =>
    startTransition(async () => {
      // Yalnız önizlenen taslaklar: sunucu taslak özeti değişmişse o yüzeyi yayınlamaz.
      const res = await publishAllDrafts((preview?.groups ?? []).map((g) => ({ surface: g.surface, hash: g.hash })));
      if (res.error) {
        setError(res.error);
        return;
      }
      setItems(res.items ?? []);
      router.refresh();
    });

  const groups = preview?.groups ?? [];
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" icon={Rocket} onClick={show}>
        Taslakları önizle ve tümünü yayınla
      </Button>
      <DialogContent size="lg">
        <DialogHeader icon={<Rocket />} title="Bekleyen taslaklar" description="Tüm yüzeylerin taslak farkları. Onaylarsanız sırayla yayınlanır; biri hata verirse diğerleri sürer." />
        <DialogBody className="space-y-4">
          {!preview ? (
            <p className="flex items-center gap-2 text-sm text-text-muted">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Farklar hazırlanıyor…
            </p>
          ) : preview.error ? (
            <p role="alert" className="text-sm text-danger-700">{preview.error}</p>
          ) : items ? (
            <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line" aria-label="Yayın sonuçları">
              {items.map((it) => (
                <li key={it.surface} className="flex items-center gap-2 p-3 text-sm">
                  {it.ok ? <CheckCircle2 className="h-4 w-4 text-mint-700" aria-hidden="true" /> : <XCircle className="h-4 w-4 text-danger-700" aria-hidden="true" />}
                  <span className="font-semibold text-ink-950">{it.label}</span>
                  <span className="text-text-muted">· {it.message}</span>
                </li>
              ))}
            </ul>
          ) : groups.length === 0 ? (
            <p className="text-sm text-text-muted">Bekleyen taslak yok: tüm yüzeyler canlı sürümle aynı.</p>
          ) : (
            groups.map((g) => (
              <section key={g.surface} className="space-y-2">
                <h3 className="text-sm font-extrabold text-ink-950">
                  {g.label} <span className="font-semibold text-text-faint">· {g.total} alan farklı</span>
                </h3>
                <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line">
                  {g.rows.map((r) => (
                    <li key={`${r.kind}:${r.path}`} className="space-y-1 p-2.5 text-xs">
                      <code className="break-all font-semibold text-ink-950">{r.path}</code>
                      <BeforeAfter before={r.before} after={r.after} />
                    </li>
                  ))}
                </ul>
                {g.more ? <p className="text-xs text-text-muted">{g.more}</p> : null}
              </section>
            ))
          )}
          {error ? <p role="alert" className="text-sm font-semibold text-danger-700">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Kapat</Button>
          {groups.length > 0 && !items ? (
            <Button icon={Rocket} loading={pending} onClick={publish}>
              Farkı gördüm, tümünü yayınla
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Yayın masası rozeti: "Henüz yansımadı — tekrar dene". */
export function RecheckButton({ surface }: { surface: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <span className="inline-flex items-center gap-1">
      <Button
        size="xs"
        variant="ghost"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await recheckLive(surface);
            setMsg(res.error ?? res.message ?? null);
            router.refresh();
          })
        }
      >
        Tekrar dene
      </Button>
      {msg ? <span role="status" className="text-xs text-text-muted">{msg}</span> : null}
    </span>
  );
}
