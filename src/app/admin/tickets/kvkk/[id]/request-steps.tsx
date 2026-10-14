"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Eraser, FileSearch, IdCard, Mail, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { StepUpCodeField } from "@/components/admin/step-up";
import {
  applyKvkkErasure,
  assignKvkkRequest,
  prepareKvkkPackage,
  recordKvkkIdentity,
  respondKvkkRequest,
  type AdminKvkkResult,
} from "@/app/actions/admin-kvkk-requests";
import { IDENTITY_METHODS, IDENTITY_METHOD_LABELS, RESPONSE_MAX, type PlatformKvkkType } from "@/lib/compliance/platform-kvkk";
import { cn } from "@/lib/utils";

type Props = {
  id: string;
  refNo: string;
  type: PlatformKvkkType;
  closed: boolean;
  identityStatus: string;
  assignedToMe: boolean;
  packageBlock: string | null;
  erasureBlock: string | null;
  completeBlock: string | null;
  isErasure: boolean;
  erasureDone: boolean;
  packageDone: boolean;
  defaultCompleted: string;
  defaultRejected: string;
  response: { text: string; at: string; by: string; delivery: string } | null;
};

function Step({ no, title, icon: Icon, done, children }: { no: number; title: string; icon: typeof IdCard; done?: boolean; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 sm:p-5">
      <h2 className="flex items-center gap-2 font-display text-sm font-bold text-ink-950">
        <span
          className={cn(
            "grid h-6 w-6 place-items-center rounded-full text-xs font-bold",
            done ? "bg-mint-500/15 text-mint-700" : "bg-brand-600/10 text-brand-700",
          )}
          aria-hidden
        >
          {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : no}
        </span>
        <Icon className="h-4 w-4 text-brand-600" aria-hidden /> {title}
      </h2>
      {children}
    </section>
  );
}

function ResultLine({ r }: { r: AdminKvkkResult | null }) {
  if (!r) return null;
  return (
    <p role={r.error ? "alert" : "status"} className={cn("text-xs font-semibold", r.error ? "text-danger-600" : "text-mint-700")}>
      {r.error ?? r.message}
    </p>
  );
}

/**
 * Başvuru adımları (istemci): kimlik → kayıtları tara (veri paketi) → silme (yalnız silme başvurusu; doğrulayıcı kodu) →
 * yanıt + sonuç. Kapı kuralları sunucuda (`platform-kvkk.ts` blocker'ları) ve burada aynı metinle gösterilir.
 */
export function KvkkRequestSteps(p: Props) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, AdminKvkkResult | null>>({});
  const [outcome, setOutcome] = useState<"completed" | "rejected">(p.completeBlock ? "rejected" : "completed");
  const [text, setText] = useState(p.completeBlock ? p.defaultRejected : p.defaultCompleted);
  const [textTouched, setTextTouched] = useState(false);

  const run = (key: string, action: (fd: FormData) => Promise<AdminKvkkResult>, fd: FormData) => {
    fd.set("id", p.id);
    setBusy(key);
    start(async () => {
      const r = await action(fd);
      setResults((prev) => ({ ...prev, [key]: r }));
      setBusy(null);
    });
  };
  const submit = (key: string, action: (fd: FormData) => Promise<AdminKvkkResult>) => (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    run(key, action, new FormData(e.currentTarget));
  };

  if (p.closed && p.response) {
    return (
      <Step no={4} title="Yanıt ve sonuç" icon={Mail} done>
        <p className="text-xs text-text-muted">
          {p.response.at} · {p.response.by} · {p.response.delivery}
        </p>
        <p className="whitespace-pre-wrap rounded-[var(--radius-control)] border border-line bg-surface-sunken p-3 text-sm text-ink-950">{p.response.text}</p>
      </Step>
    );
  }

  const identityDone = p.identityStatus === "verified";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          icon={UserPlus}
          loading={pending && busy === "assign"}
          onClick={() => {
            const fd = new FormData();
            if (p.assignedToMe) fd.set("release", "1");
            run("assign", assignKvkkRequest, fd);
          }}
        >
          {p.assignedToMe ? "Başvuruyu bırak" : "Başvuruyu üstlen"}
        </Button>
        <ResultLine r={results.assign ?? null} />
      </div>

      <Step no={1} title="Kimlik doğrulama" icon={IdCard} done={identityDone}>
        <p className="text-xs text-text-muted">
          E-posta adresi kodla doğrulandı. Veri paylaşmadan ya da silmeden önce başvuru sahibinin kimliğini teyit edin (KVKK başvuru
          tebliği: yazılı, KEP, güvenli e-imza ya da sistemde kayıtlı e-posta). Teyit edemezseniz &quot;doğrulanamadı&quot; kaydedip başvuruyu gerekçeyle reddedin.
        </p>
        <form onSubmit={submit("identity", recordKvkkIdentity)} className="grid gap-3 sm:grid-cols-2">
          <FormField label="Yöntem" htmlFor="kvkk-kimlik-yontem" required>
            <FormSelect id="kvkk-kimlik-yontem" name="method" required defaultValue="email_document">
              {IDENTITY_METHODS.map((m) => (
                <option key={m} value={m}>
                  {IDENTITY_METHOD_LABELS[m]}
                </option>
              ))}
            </FormSelect>
          </FormField>
          <FormField label="Sonuç" htmlFor="kvkk-kimlik-sonuc" required>
            <FormSelect id="kvkk-kimlik-sonuc" name="result" required defaultValue="verified">
              <option value="verified">Kimlik doğrulandı</option>
              <option value="failed">Kimlik doğrulanamadı</option>
            </FormSelect>
          </FormField>
          <FormField label="Not" htmlFor="kvkk-kimlik-not" hint="Hangi belgeyle teyit edildi; doğrulanamadıysa nedeni (kişisel belge numarası yazmayın)." className="sm:col-span-2">
            <FormTextarea id="kvkk-kimlik-not" name="note" rows={2} maxLength={1000} />
          </FormField>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button type="submit" size="sm" loading={pending && busy === "identity"}>
              Kimlik kaydını kaydet
            </Button>
            <ResultLine r={results.identity ?? null} />
          </div>
        </form>
      </Step>

      <Step no={2} title="Kayıtları tara (veri paketi)" icon={FileSearch} done={p.packageDone}>
        <p className="text-xs text-text-muted">
          Kişinin e-posta ve telefonuyla eşleşen kayıtlar tüm ofislerde taranır ve özet kaydedilir. Dosya: Raporlar &gt; Rapor merkezi &gt; &quot;KVKK veri
          paketi&quot; raporu, başvuru no <b>{p.refNo}</b>.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant={p.packageDone ? "outline" : "primary"}
            disabled={Boolean(p.packageBlock)}
            loading={pending && busy === "package"}
            onClick={() => run("package", prepareKvkkPackage, new FormData())}
          >
            {p.packageDone ? "Yeniden tara" : "Kayıtları tara"}
          </Button>
          {p.packageBlock ? <span className="text-xs text-text-muted">{p.packageBlock}</span> : null}
          <ResultLine r={results.package ?? null} />
        </div>
      </Step>

      {p.isErasure ? (
        <Step no={3} title="Silme / anonimleştirme" icon={Eraser} done={p.erasureDone}>
          <p className="text-xs text-text-muted">
            Eşleşen ofis müşteri kayıtlarına mevcut anonimleştirme akışı uygulanır (ad, telefon, e-posta, notlar silinir; anlaşma, çağrı ve muhasebe
            satırları yasal saklama gereği korunur, kişi alanları maskelenir). EmlakSoft demo talepleri ve açık ev kayıtları anonimleşir. Geri alınamaz.
          </p>
          {p.erasureBlock && !p.erasureDone ? <p className="text-xs text-text-muted">{p.erasureBlock}</p> : null}
          {!p.erasureDone ? (
            <form onSubmit={submit("erasure", applyKvkkErasure)} className="space-y-3">
              <label className="flex items-start gap-2 text-xs text-ink-950">
                <input type="checkbox" name="confirm" required className="mt-0.5 h-4 w-4 accent-brand-600" disabled={Boolean(p.erasureBlock)} />
                <span>Kişinin kimliğini doğruladım; eşleşen kayıtların geri alınamaz biçimde anonimleştirileceğini anlıyorum.</span>
              </label>
              {!p.erasureBlock ? <StepUpCodeField id="kvkk-silme-kod" /> : null}
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" size="sm" variant="danger" disabled={Boolean(p.erasureBlock)} loading={pending && busy === "erasure"}>
                  Silmeyi uygula
                </Button>
                <ResultLine r={results.erasure ?? null} />
              </div>
            </form>
          ) : (
            <ResultLine r={results.erasure ?? { ok: true, message: "Silme uygulandı; sonuç yukarıda." }} />
          )}
        </Step>
      ) : null}

      <Step no={p.isErasure ? 4 : 3} title="Yanıt ve sonuç" icon={Mail}>
        <p className="text-xs text-text-muted">
          Yanıt, e-posta şablonu &quot;KVKK başvurusu yanıtı&quot; (Ayarlar &gt; E-posta &gt; Şablonlar) içindeki yanıt alanına yerleşir ve başvuru sahibine
          gönderilir. Sonuçlandırınca 30 gün sayacı durur.
        </p>
        <form onSubmit={submit("respond", respondKvkkRequest)} className="space-y-3">
          <FormField label="Sonuç" htmlFor="kvkk-sonuc" required>
            <FormSelect
              id="kvkk-sonuc"
              name="outcome"
              value={outcome}
              onChange={(e) => {
                const next = e.target.value === "rejected" ? "rejected" : "completed";
                setOutcome(next);
                if (!textTouched) setText(next === "rejected" ? p.defaultRejected : p.defaultCompleted);
              }}
            >
              <option value="completed" disabled={Boolean(p.completeBlock)}>
                Talep yerine getirildi
              </option>
              <option value="rejected">Reddedildi (gerekçeli)</option>
            </FormSelect>
          </FormField>
          {outcome === "completed" && p.completeBlock ? <p className="text-xs text-text-muted">{p.completeBlock}</p> : null}
          <FormField label="Yanıt metni" htmlFor="kvkk-yanit" required hint={`${text.length} / ${RESPONSE_MAX}`}>
            <FormTextarea
              id="kvkk-yanit"
              name="response"
              rows={6}
              maxLength={RESPONSE_MAX}
              required
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setTextTouched(true);
              }}
            />
          </FormField>
          <label className="flex items-center gap-2 text-xs text-ink-950">
            <input type="checkbox" name="yanit_gonder" defaultChecked className="h-4 w-4 accent-brand-600" />
            Yanıtı başvuru sahibine e-postayla gönder (kapalıysa yanıt KEP/posta ile iletilmiş sayılır, yalnız sonuç kaydedilir)
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="sm" loading={pending && busy === "respond"} disabled={outcome === "completed" && Boolean(p.completeBlock)}>
              {outcome === "completed" ? "Yanıtla ve sonuçlandır" : "Gerekçeyle reddet"}
            </Button>
            <ResultLine r={results.respond ?? null} />
          </div>
        </form>
      </Step>
    </div>
  );
}
