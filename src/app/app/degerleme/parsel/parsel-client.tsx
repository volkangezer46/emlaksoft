"use client";

import { useState, useTransition } from "react";
import Link from "@/components/ui/smart-link";
import { useRouter } from "next/navigation";
import { Loader2, MapPin, Wallet } from "lucide-react";
import { efCheckGeoMatch, efLoadIlceler, efLoadMahalleler, submitParcelValuation, type EfGeoOption } from "@/app/actions/ef-valuation";
import {
  freeTextHasPersonalData,
  ORTAK_FREE_TEXT_WARNING,
} from "@/lib/integrations/emlakfiyati/ortak-text";
import type { OrtakValuationInput } from "@/lib/integrations/emlakfiyati/ortak-contract";
import type { RunValuationResult } from "@/lib/ef-credits/types";
import { EfResultView } from "./result-view";

const field =
  "focus-ring h-10 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 text-sm text-ink-950 outline-none focus:border-brand-300 disabled:opacity-60";
const label = "mb-1.5 block text-sm text-text-muted";
const btn = "focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] px-4 py-2 text-sm font-semibold disabled:opacity-60";

type Props = {
  iller: EfGeoOption[];
  illerError: string | null;
  balance: number;
  unitsArsa: number;
  unitsKonut: number;
};

type Tri = "" | "1" | "0";
const triValue = (v: Tri): boolean | undefined => (v === "" ? undefined : v === "1");
const numOrUndef = (s: string): number | undefined => {
  const t = s.trim().replace(",", ".");
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
};

function TriSelect({ name, text, value, onChange }: { name: string; text: string; value: Tri; onChange: (v: Tri) => void }) {
  return (
    <label className="block">
      <span className={label}>{text}</span>
      <select name={name} value={value} onChange={(e) => onChange(e.target.value as Tri)} className={field}>
        <option value="">Bilinmiyor (gönderilmez)</option>
        <option value="1">Var</option>
        <option value="0">Yok</option>
      </select>
    </label>
  );
}

export function ParselClient({ iller, illerError, balance, unitsArsa, unitsKonut }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ilId, setIlId] = useState("");
  const [ilceId, setIlceId] = useState("");
  const [mahalleId, setMahalleId] = useState("");
  const [ilceler, setIlceler] = useState<EfGeoOption[]>([]);
  const [mahalleler, setMahalleler] = useState<EfGeoOption[]>([]);
  const [geoNote, setGeoNote] = useState<string | null>(null);
  const [ada, setAda] = useState("");
  const [parsel, setParsel] = useState("");
  const [tip, setTip] = useState<"arsa" | "konut">("arsa");
  const [konutTipi, setKonutTipi] = useState<"daire" | "mustakil" | "bina">("daire");
  const [m2, setM2] = useState("");
  const [oda, setOda] = useState("");
  const [yas, setYas] = useState("");
  const [kat, setKat] = useState("");
  const [katToplam, setKatToplam] = useState("");
  const [site, setSite] = useState<Tri>("");
  const [asansor, setAsansor] = useState<Tri>("");
  const [otopark, setOtopark] = useState<Tri>("");
  const [siteAdi, setSiteAdi] = useState("");
  const [apartmanAdi, setApartmanAdi] = useState("");
  const [blok, setBlok] = useState("");
  const [extras, setExtras] = useState({ acikHavuz: false, kapaliHavuz: false, guvenlik: false, sporAlani: false, akilliEv: false });
  const [confirming, setConfirming] = useState<OrtakValuationInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<RunValuationResult | null>(null);

  const units = tip === "konut" ? unitsKonut : unitsArsa;
  const piiWarn = [siteAdi, apartmanAdi, blok].some((t) => t && freeTextHasPersonalData(t));

  function onIl(value: string) {
    setIlId(value);
    setIlceId("");
    setMahalleId("");
    setIlceler([]);
    setMahalleler([]);
    setGeoNote(null);
    if (!value) return;
    start(async () => {
      const res = await efLoadIlceler(Number(value));
      if (res.ok) setIlceler(res.items);
      else setError(res.error);
    });
  }

  function onIlce(value: string) {
    setIlceId(value);
    setMahalleId("");
    setMahalleler([]);
    setGeoNote(null);
    if (!value) return;
    start(async () => {
      const res = await efLoadMahalleler(Number(value));
      if (res.ok) setMahalleler(res.items);
      else setError(res.error);
    });
  }

  function onMahalle(value: string) {
    setMahalleId(value);
    setGeoNote(null);
    if (!value) return;
    const il = iller.find((i) => String(i.id) === ilId)?.ad ?? "";
    const ilce = ilceler.find((i) => String(i.id) === ilceId)?.ad ?? "";
    const mahalle = mahalleler.find((i) => String(i.id) === value)?.ad ?? "";
    start(async () => {
      const res = await efCheckGeoMatch({ il, ilce, mahalle });
      if (res.ok && !res.matched) setGeoNote(res.note);
    });
  }

  async function buildInput(): Promise<OrtakValuationInput | null> {
    const base = {
      mahalleId: Number(mahalleId),
      ada: ada.trim(),
      parsel: parsel.trim(),
      tip,
      konut:
        tip === "konut"
          ? {
              konutTipi,
              konutM2: numOrUndef(m2) as number,
              odaSayi: numOrUndef(oda),
              binaYasi: numOrUndef(yas),
              kat: numOrUndef(kat),
              katToplam: numOrUndef(katToplam),
              site: triValue(site),
              asansor: triValue(asansor),
              otopark: triValue(otopark),
              siteAdi: siteAdi.trim() || undefined,
              apartmanAdi: apartmanAdi.trim() || undefined,
              blok: blok.trim() || undefined,
              ...extras,
            }
          : undefined,
    } satisfies OrtakValuationInput;
    if (!mahalleId) {
      setError("Önce il, ilçe ve mahalle seçin.");
      return null;
    }
    if (tip === "konut" && !Number.isFinite(base.konut?.konutM2)) {
      setError("Konut değerlemesi için alan (m²) bilgisi zorunludur.");
      return null;
    }
    // Ön doğrulama şeması (zod) yalnız tıklamada yüklenir: sayfa ilk yükünde zod (~280 KB ham) inmez. Sunucu yeniden doğrular.
    const { ortakValuationInputSchema } = await import("@/lib/integrations/emlakfiyati/ortak-contract");
    const parsed = ortakValuationInputSchema.safeParse(base);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Girdiler geçersiz.");
      return null;
    }
    return base;
  }

  async function onPrepare() {
    setError(null);
    setRun(null);
    setConfirming(await buildInput());
  }

  function onConfirm() {
    if (!confirming) return;
    const input = confirming;
    setError(null);
    start(async () => {
      const res = await submitParcelValuation(input);
      setConfirming(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRun(res.run);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]" aria-busy={pending}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display font-bold text-ink-950">Yeni ada/parsel değerlemesi</h2>
          <Link
            href="#gecmis-raporlar"
            className="focus-ring press inline-flex items-center gap-1.5 rounded-full border border-mint-500/30 bg-mint-500/10 px-3 py-1 text-xs font-bold text-mint-700"
            aria-label={`Kalan kontör ${balance}; geçmiş raporlara git`}
          >
            <Wallet className="h-3.5 w-3.5" aria-hidden="true" /> Kalan kontör: <span className="numeric">{balance}</span>
          </Link>
        </div>

        {illerError ? (
          <p role="alert" className="mt-3 rounded-[var(--radius-card)] border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-sm text-danger-600">
            {illerError}
          </p>
        ) : null}

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className={label}>İl</span>
            <select value={ilId} onChange={(e) => onIl(e.target.value)} className={field} disabled={iller.length === 0}>
              <option value="">İl seçin</option>
              {iller.map((i) => (
                <option key={i.id} value={i.id}>{i.ad}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={label}>İlçe</span>
            <select value={ilceId} onChange={(e) => onIlce(e.target.value)} className={field} disabled={!ilId || ilceler.length === 0}>
              <option value="">İlçe seçin</option>
              {ilceler.map((i) => (
                <option key={i.id} value={i.id}>{i.ad}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={label}>Mahalle</span>
            <select value={mahalleId} onChange={(e) => onMahalle(e.target.value)} className={field} disabled={!ilceId || mahalleler.length === 0}>
              <option value="">Mahalle seçin</option>
              {mahalleler.map((i) => (
                <option key={i.id} value={i.id}>{i.ad}</option>
              ))}
            </select>
          </label>
          {geoNote ? (
            <p role="status" className="flex gap-2 rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-800">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {geoNote}
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={label}>Ada</span>
              <input value={ada} onChange={(e) => setAda(e.target.value)} inputMode="numeric" maxLength={12} placeholder="101" className={field} />
            </label>
            <label className="block">
              <span className={label}>Parsel</span>
              <input value={parsel} onChange={(e) => setParsel(e.target.value)} maxLength={20} placeholder="1" className={field} />
            </label>
          </div>

          <fieldset>
            <legend className={label}>Tür</legend>
            <div className="flex gap-2">
              {(["arsa", "konut"] as const).map((t) => (
                <label
                  key={t}
                  className={`focus-within:ring-2 cursor-pointer rounded-[var(--radius-control)] border px-4 py-2 text-sm font-semibold ${
                    tip === t ? "border-brand-600 bg-brand-600/8 text-brand-700" : "border-line bg-surface text-ink-950"
                  }`}
                >
                  <input type="radio" name="tip" value={t} checked={tip === t} onChange={() => setTip(t)} className="sr-only" />
                  {t === "arsa" ? "Arsa" : "Konut"}
                </label>
              ))}
            </div>
          </fieldset>

          {tip === "konut" ? (
            <div className="space-y-3 rounded-[var(--radius-card)] border border-line bg-canvas/60 p-3">
              <p className="text-xs text-text-muted">Konut değerlemesinde alan (m²) zorunludur; bilmediğiniz alanları boş bırakın.</p>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className={label}>Konut tipi</span>
                  <select value={konutTipi} onChange={(e) => setKonutTipi(e.target.value as typeof konutTipi)} className={field}>
                    <option value="daire">Daire</option>
                    <option value="mustakil">Müstakil</option>
                    <option value="bina">Bina</option>
                  </select>
                </label>
                <label className="block">
                  <span className={label}>Alan (m²) *</span>
                  <input value={m2} onChange={(e) => setM2(e.target.value)} inputMode="decimal" className={field} />
                </label>
                <label className="block">
                  <span className={label}>Oda sayısı</span>
                  <input value={oda} onChange={(e) => setOda(e.target.value)} inputMode="numeric" className={field} />
                </label>
                <label className="block">
                  <span className={label}>Bina yaşı</span>
                  <input value={yas} onChange={(e) => setYas(e.target.value)} inputMode="numeric" className={field} />
                </label>
                <label className="block">
                  <span className={label}>Bulunduğu kat</span>
                  <input value={kat} onChange={(e) => setKat(e.target.value)} inputMode="numeric" className={field} />
                </label>
                <label className="block">
                  <span className={label}>Toplam kat</span>
                  <input value={katToplam} onChange={(e) => setKatToplam(e.target.value)} inputMode="numeric" className={field} />
                </label>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <TriSelect name="site" text="Site içi" value={site} onChange={setSite} />
                <TriSelect name="asansor" text="Asansör" value={asansor} onChange={setAsansor} />
                <TriSelect name="otopark" text="Otopark" value={otopark} onChange={setOtopark} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <label className="block">
                  <span className={label}>Site adı</span>
                  <input value={siteAdi} onChange={(e) => setSiteAdi(e.target.value)} maxLength={100} className={field} />
                </label>
                <label className="block">
                  <span className={label}>Apartman adı</span>
                  <input value={apartmanAdi} onChange={(e) => setApartmanAdi(e.target.value)} maxLength={100} className={field} />
                </label>
                <label className="block">
                  <span className={label}>Blok</span>
                  <input value={blok} onChange={(e) => setBlok(e.target.value)} maxLength={40} className={field} />
                </label>
              </div>
              <p className={`text-xs ${piiWarn ? "font-semibold text-danger-600" : "text-text-muted"}`} role={piiWarn ? "alert" : undefined}>
                {ORTAK_FREE_TEXT_WARNING} @ işareti ve 11 haneli sayılar kabul edilmez.
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-ink-950">
                {(
                  [
                    ["acikHavuz", "Açık havuz"],
                    ["kapaliHavuz", "Kapalı havuz"],
                    ["guvenlik", "Güvenlik"],
                    ["sporAlani", "Spor alanı"],
                    ["akilliEv", "Akıllı ev"],
                  ] as const
                ).map(([k, text]) => (
                  <label key={k} className="inline-flex items-center gap-2">
                    <input type="checkbox" checked={extras[k]} onChange={(e) => setExtras((x) => ({ ...x, [k]: e.target.checked }))} className="h-4 w-4" />
                    {text}
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {error ? <p role="alert" className="text-sm font-medium text-danger-600">{error}</p> : null}

          {confirming ? (
            <div role="group" aria-label="İşlem onayı" className="rounded-[var(--radius-card)] border border-brand-600/25 bg-brand-600/6 p-4">
              <p className="text-sm font-semibold text-ink-950">
                Bu işlem <span className="numeric">{units}</span> kontör{units === 0 ? " (ücretsiz)" : ""}.
              </p>
              <p className="mt-1 text-xs text-text-muted">
                Kalan kontör: <span className="numeric">{balance}</span>. Sonuç üretilemezse (yetersiz veri) veya hata olursa kontör düşmez. Rapor PDF&apos;i ve rapor detayı kontör düşürmez.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={onConfirm} disabled={pending} className={`${btn} bg-ink-950 text-white`}>
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null} Onayla ve değerle
                </button>
                <button type="button" onClick={() => setConfirming(null)} disabled={pending} className={`${btn} border border-line bg-surface text-ink-950`}>
                  Vazgeç
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={onPrepare} disabled={pending || iller.length === 0 || piiWarn} className={`${btn} bg-brand-600 text-white`}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null} Değerlemeyi hazırla
            </button>
          )}
        </div>
      </section>

      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]" aria-live="polite">
        <h2 className="font-display font-bold text-ink-950">Sonuç</h2>
        {pending && confirming === null && run === null && !error ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Değerleme hazırlanıyor; bu işlem bir dakikayı bulabilir.
          </p>
        ) : null}
        {!run ? (
          <p className="mt-4 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-10 text-center text-sm text-text-muted">
            Soldan il, ilçe, mahalle, ada ve parseli girin. Onayınızdan sonra sonuç burada görünür.
          </p>
        ) : (
          <RunOutcome run={run} />
        )}
      </section>
    </div>
  );
}

function RunOutcome({ run }: { run: RunValuationResult }) {
  switch (run.status) {
    case "ok":
      return (
        <div className="mt-4 space-y-3">
          <p role="status" className="rounded-[var(--radius-card)] border border-mint-500/30 bg-mint-500/10 px-3 py-2 text-sm font-semibold text-mint-700">
            Rapor hazır. {run.unitsCharged > 0 ? `${run.unitsCharged} kontör düşüldü.` : "Kontör düşülmedi."}
            {run.replayed ? " (Aynı istek tekrarı: ikinci kez ücretlendirilmedi.)" : ""}
          </p>
          {run.settlementPending ? (
            <p role="note" className="text-xs text-amber-800">Kontör kaydı şu an tamamlanamadı; rapor verildi, mutabakat yöneticide izlenir.</p>
          ) : null}
          <EfResultView result={run.result} raporId={run.raporId} />
        </div>
      );
    case "insufficient":
      return (
        <div role="status" className="mt-4 space-y-2 rounded-[var(--radius-card)] border border-line bg-canvas/60 p-4">
          <p className="font-display text-lg font-bold text-ink-950">Bu parsel için sonuç üretilemedi</p>
          {run.result.mesaj ? <p className="text-sm text-text-muted">{run.result.mesaj}</p> : null}
          {run.result.nedenler.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {run.result.nedenler.map((n) => (
                <li key={n} className="rounded-full bg-ink-950/6 px-2.5 py-0.5 text-xs font-semibold text-text-muted">{n.replace(/_/g, " ")}</li>
              ))}
            </ul>
          ) : null}
          <p className="text-sm font-semibold text-mint-700">Ücretlendirilmedi{run.refunded ? " (kontör iade edildi)" : ""}.</p>
        </div>
      );
    case "no_credit":
      return (
        <div role="alert" className="mt-4 rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/10 p-4 text-sm text-amber-800">
          <p className="font-semibold">Yetersiz kontör: bu işlem {run.needed} kontör, kalan {run.available}.</p>
          <p className="mt-1">Kontör paketlerini <Link href="/app/abonelik?sekme=kontor#paketler" className="font-semibold underline">Abonelik &gt; Kontör</Link> sayfasından alabilirsiniz (satın alma yalnızca ofis sahibi veya genel müdür içindir; değilseniz yöneticinize başvurun).</p>
        </div>
      );
    case "disabled":
      return (
        <div role="alert" className="mt-4 space-y-1 rounded-[var(--radius-card)] border border-line bg-canvas/60 p-4 text-sm text-text-muted">
          <p className="font-semibold text-ink-950">{run.message}</p>
          <ul className="list-disc pl-5">
            {run.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      );
    case "invalid":
      return <p role="alert" className="mt-4 text-sm font-medium text-danger-600">{run.message}</p>;
    case "error":
      return (
        <p role="alert" className="mt-4 rounded-[var(--radius-card)] border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-sm text-danger-600">
          {run.message}
          {run.requestId ? <span className="mt-1 block text-xs text-text-muted">Destek için istek kodu: {run.requestId}</span> : null}
        </p>
      );
  }
}
