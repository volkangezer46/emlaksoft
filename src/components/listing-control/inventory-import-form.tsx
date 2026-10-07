"use client";

import Link from "next/link";
import { useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, ClipboardList, RadioTower } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { FileInput } from "@/components/ui/file-input";
import { bridgeInstalled, bridgePaused, requestInventoryPage } from "@/lib/listing-control/worker/bridge";
import { importPortalInventory, type InventoryImportResult } from "@/app/actions/listing-control-inventory";
import { CONTROL_BASE, kpiHref } from "./helpers";
import { isLegacyXls, isXlsxFile } from "@/lib/xlsx-import";

/**
 * Portal envanteri karşılaştırma formu. Kaynak: portal hesabından indirilen CSV veya .xlsx (dinamik okunur, CSV metnine çevrilir) ya da
 * başlıklı tabloyu kopyalayıp yapıştırın), yapıştırılan ilan no/URL listesi, ya da tarayıcı eklentisiyle portal mağaza
 * sayfasından okuma (kullanıcının kendi tarayıcısında, en çok 10 sayfa, sayfa arası ≥ 20 sn). Liste TAM değilse
 * "listede yok" kayıp sayılmaz.
 */

const PORTALS = [
  { id: "sahibinden", label: "Sahibinden" },
  { id: "hepsiemlak", label: "Hepsiemlak" },
  { id: "emlakjet", label: "Emlakjet" },
] as const;

type Source = "csv" | "paste" | "extension";

const fieldClass =
  "w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface";

const MAX_FILE_BYTES = 3_500_000;
const MAX_STORE_PAGES = 10;

export function InventoryImportForm({ canOffice }: { canOffice: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [portal, setPortal] = useState<string>("sahibinden");
  const [scope, setScope] = useState<"mine" | "office">(canOffice ? "office" : "mine");
  const [source, setSource] = useState<Source>("csv");
  const [fileText, setFileText] = useState<string>("");
  const [pasteText, setPasteText] = useState<string>("");
  const [complete, setComplete] = useState(false);
  const [storeUrl, setStoreUrl] = useState("");
  const [storeItems, setStoreItems] = useState<{ externalId: string; url: string | null }[]>([]);
  const [storeComplete, setStoreComplete] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Extract<InventoryImportResult, { ok: true }> | null>(null);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    setError(null);
    const f = e.target.files?.[0];
    if (!f) return setFileText("");
    if (f.size > MAX_FILE_BYTES) {
      setFileText("");
      return setError("Dosya çok büyük (en fazla ~3,5 MB / 5000 ilan).");
    }
    if (isLegacyXls(f)) {
      setFileText("");
      return setError("Eski Excel biçimi (.xls) desteklenmiyor: .xlsx ya da \"CSV UTF-8\" olarak kaydedip yükleyin veya tabloyu \"Yapıştır\" sekmesine yapıştırın.");
    }
    if (isXlsxFile(f)) {
      // Kütüphane yalnız burada dinamik yüklenir; ilk sayfa CSV metnine çevrilip aynı sunucu ayrıştırıcısına gider.
      try {
        const { readXlsxTable, tableToCsvText } = await import("@/lib/xlsx-import");
        return setFileText(tableToCsvText(await readXlsxTable(await f.arrayBuffer())));
      } catch {
        setFileText("");
        return setError("Excel dosyası okunamadı. Dosyayı .xlsx ya da CSV olarak yeniden kaydedip deneyin.");
      }
    }
    setFileText(await f.text());
  }

  async function readStore() {
    setError(null);
    setStoreItems([]);
    setStoreComplete(false);
    if (!bridgeInstalled()) return setError("Tarayıcı eklentisi bulunamadı.");
    if (bridgePaused()) return setError("Eklenti duraklatılmış; eklenti simgesinden sürdürün.");
    let url: string | null = storeUrl.trim();
    if (!/^https:\/\//i.test(url)) return setError("Mağaza sayfasının https ile başlayan adresini girin.");
    const items = new Map<string, { externalId: string; url: string | null }>();
    let pages = 0;
    let finished = false;
    while (url && pages < MAX_STORE_PAGES) {
      pages += 1;
      setReading(`Sayfa ${pages} okunuyor (eklenti portalı yormamak için sayfalar arasında en az 20 sn bekler)…`);
      const reply = (await requestInventoryPage({ id: crypto.randomUUID(), portal, url }, 120_000)) as {
        items?: { externalId?: string; url?: string }[];
        nextUrl?: string | null;
        error?: string | null;
      };
      if (reply?.error) {
        setReading(null);
        setStoreItems([...items.values()]);
        return setError(
          reply.error === "captcha" || reply.error === "login_required" || reply.error === "http_429" || reply.error === "http_403"
            ? "Portal doğrulama/giriş istedi ya da hız sınırına takıldı. Eklenti bunu aşmaz; portalı tarayıcınızda açıp normal şekilde kullanın, sonra tekrar deneyin. Okunan kısım TAM liste sayılmaz."
            : reply.error === "no_items"
              ? "Bu sayfada ilan bulunamadı (sayfa yapısı tanınmadı olabilir). Okunan kısım TAM liste sayılmaz."
              : reply.error === "busy" || reply.error === "paused"
                ? "Eklenti şu an bekliyor (duraklatılmış, saatlik sınır ya da portal engeli sonrası bekleme). Biraz sonra tekrar deneyin; okunan kısım TAM liste sayılmaz."
                : `Liste okunamadı (${reply.error}). Okunan kısım TAM liste sayılmaz.`,
        );
      }
      for (const it of reply?.items ?? []) if (it.externalId) items.set(it.externalId, { externalId: it.externalId, url: it.url ?? null });
      url = reply?.nextUrl ?? null;
      if (!url) finished = true;
    }
    setReading(null);
    setStoreItems([...items.values()]);
    setStoreComplete(finished);
    if (!finished) setError(`İlk ${MAX_STORE_PAGES} sayfa okundu; liste daha uzun olduğu için TAM sayılmadı.`);
  }

  function submit() {
    setError(null);
    setResult(null);
    const text = source === "csv" ? fileText : source === "paste" ? pasteText : "";
    if (source === "csv" && !text) return setError("Önce bir CSV dosyası seçin.");
    if (source === "paste" && !text.trim()) return setError("İlan numaralarını ya da bağlantılarını yapıştırın.");
    if (source === "extension" && storeItems.length === 0) return setError("Önce eklentiyle listeyi okuyun.");
    start(async () => {
      const r = await importPortalInventory({
        portal,
        scope,
        source,
        complete: source === "extension" ? storeComplete : complete,
        text,
        items: source === "extension" ? storeItems : undefined,
      });
      if (!r.ok) return setError(r.error);
      setResult(r);
      router.refresh();
    });
  }

  const tab = (s: Source, label: string, Icon: typeof FileSpreadsheet) => (
    <button
      type="button"
      role="tab"
      aria-selected={source === s}
      onClick={() => setSource(s)}
      className={`focus-ring inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-control)] border px-3 text-sm font-semibold transition ${source === s ? "border-brand-500 bg-brand-600 text-white" : "border-line bg-surface text-text hover:border-brand-400"}`}
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium text-text">
          Portal
          <select value={portal} onChange={(e) => setPortal(e.target.value)} className={`${fieldClass} mt-1.5`}>
            {PORTALS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="text-sm font-medium text-text">
          <legend>Karşılaştırma kapsamı</legend>
          <div className="mt-2 flex flex-wrap gap-4">
            <label className="inline-flex items-center gap-2 font-normal">
              <input type="radio" name="scope" checked={scope === "mine"} onChange={() => setScope("mine")} /> Benim portföylerim
            </label>
            {canOffice ? (
              <label className="inline-flex items-center gap-2 font-normal">
                <input type="radio" name="scope" checked={scope === "office"} onChange={() => setScope("office")} /> Ofis geneli (kurumsal hesap)
              </label>
            ) : null}
          </div>
        </fieldset>
      </div>

      <div role="tablist" aria-label="Liste kaynağı" className="flex flex-wrap gap-2">
        {tab("csv", "Dosya (CSV)", FileSpreadsheet)}
        {tab("paste", "Yapıştır", ClipboardList)}
        {tab("extension", "Eklentiyle oku", RadioTower)}
      </div>

      {source === "csv" ? (
        <div className="space-y-2">
          <FileInput accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFile} buttonLabel="CSV / Excel dosyası seç" />
          <p className="text-xs text-text-muted">
            Portal ofis panelinden ilan listenizi dışa aktarın. İlan No sütunu zorunlu; Fiyat, Durum, Danışman sütunları varsa fiyat ve danışman uyuşmazlığı da bulunur. Excel çalışma kitabı (.xlsx, ilk sayfa) doğrudan yüklenebilir.
          </p>
        </div>
      ) : null}
      {source === "paste" ? (
        <label className="block text-sm font-medium text-text">
          İlan numaraları, ilan bağlantıları ya da Excel&apos;den kopyalanan başlıklı tablo
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={8}
            maxLength={400_000}
            className={`${fieldClass} mt-1.5 font-mono`}
            placeholder={"1234567890\nhttps://www.sahibinden.com/ilan/...-1234567891/detay"}
          />
        </label>
      ) : null}
      {source === "extension" ? (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-text">
            Portal mağaza / ilanlarım sayfası adresi
            <input value={storeUrl} onChange={(e) => setStoreUrl(e.target.value)} inputMode="url" className={`${fieldClass} mt-1.5`} placeholder="https://…" />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" onClick={() => void readStore()} loading={reading !== null}>
              Listeyi oku
            </Button>
            <Link href={`${CONTROL_BASE}/eklenti`} className="focus-ring rounded text-sm font-semibold text-accent-text hover:underline">
              Eklenti kurulumu
            </Link>
          </div>
          {reading ? <p role="status" className="text-sm text-text-muted">{reading}</p> : null}
          {storeItems.length > 0 && !reading ? (
            <p className="text-sm text-text">
              {storeItems.length} ilan okundu · {storeComplete ? "liste tam (bütün sayfalar okundu)" : "liste TAM değil (kayıp sayılmaz)"}
            </p>
          ) : null}
          <p className="text-xs text-text-muted">
            Yalnız sizin tarayıcınızda, sizin görebildiğiniz sayfa düşük hızla okunur. Portal doğrulama ya da giriş isterse okuma durur; eklenti bunu aşmaz.
          </p>
        </div>
      ) : null}

      {source !== "extension" ? (
        <label className="flex items-start gap-2 text-sm text-text">
          <input type="checkbox" checked={complete} onChange={(e) => setComplete(e.target.checked)} className="mt-1" />
          <span>
            Bu liste portaldaki yayındaki ilanlarımın <strong>tamamı</strong>. (İşaretlemezseniz listede olmayan ilanlar kayıp sayılmaz; yalnız fiyat/danışman ve kayıtsız ilan karşılaştırılır.)
          </span>
        </label>
      ) : null}

      {error ? <Alert tone="warning">{error}</Alert> : null}

      <Button type="button" onClick={submit} loading={pending}>
        Karşılaştır
      </Button>

      {result ? <InventoryResultCard result={result} /> : null}
    </div>
  );
}

function Bucket({ label, count, codes, href, hrefLabel }: { label: string; count: number; codes?: unknown; href?: string; hrefLabel?: string }) {
  const list = Array.isArray(codes) ? (codes as string[]) : [];
  return (
    <li className="rounded-[var(--radius-control)] border border-line px-3 py-2">
      <details>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm">
          <span>{label}</span>
          <span className="font-semibold tabular-nums">{count}</span>
        </summary>
        <div className="mt-2 space-y-1 text-xs text-text-muted">
          {list.length > 0 ? <p className="font-mono">{list.join(", ")}{count > list.length ? " …" : ""}</p> : <p>Ayrıntı yok.</p>}
          {href ? (
            <Link href={href} className="focus-ring rounded font-semibold text-accent-text hover:underline">
              {hrefLabel ?? "İlgili liste"}
            </Link>
          ) : null}
        </div>
      </details>
    </li>
  );
}

export function InventoryResultCard({ result }: { result: Extract<InventoryImportResult, { ok: true }> }) {
  const s = result.summary;
  const d = s.detail as Record<string, unknown>;
  return (
    <section aria-label="Karşılaştırma sonucu" className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <h3 className="text-base font-semibold text-text">Karşılaştırma sonucu</h3>
      <p className="mt-0.5 text-sm text-text-muted">
        Portal listesinde {s.total_rows} ilan · {result.applied} kontrol kaydı işlendi · {result.registered} kayıtsız ilan eşleşme kuyruğunda · {result.opened} yeni uyarı
        {result.complete ? "" : " · liste tam olmadığı için kayıp sayılmadı"}
      </p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        <Bucket label="Eşleşen (portalda yayında)" count={s.matched} href={kpiHref("in_portals")} hrefLabel="Yayındaki portföyler" />
        <Bucket label="Kaldırılmış (CRM'de canlı, listede yok/pasif)" count={s.removed} codes={d.removed} href={`${CONTROL_BASE}/anomaliler?tur=portal_missing`} hrefLabel="Kayıp uyarıları" />
        <Bucket label="CRM'de kayıtsız (portalda var)" count={s.unregistered} codes={d.unregistered} href={`${CONTROL_BASE}/eslesme`} hrefLabel="Eşleşme kuyruğu" />
        <Bucket label="Hiç yayınlanmamış (aktif, ilansız)" count={s.never_published} href={kpiHref("awaiting_publish")} hrefLabel="Yayın bekleyenler" />
        <Bucket label="İlan no hatalı (CRM'de biçimsiz no)" count={s.id_invalid} codes={d.idInvalid} />
        <Bucket label="Kontrol edilemedi (CRM'de ilan no yok)" count={s.unverifiable} codes={d.unverifiable} />
        <Bucket label="Farklı danışman" count={s.other_advisor} codes={d.otherAdvisor} href={`${CONTROL_BASE}/anomaliler?tur=advisor_mismatch`} hrefLabel="Danışman uyuşmazlıkları" />
        <Bucket label="Fiyat farkı" count={s.price_diff} codes={d.priceDiff} href={kpiHref("price_mismatch")} hrefLabel="Fiyat uyuşmazlıkları" />
      </ul>
      {result.invalidTokens.length > 0 ? (
        <p className="mt-3 text-xs text-text-muted">Tanınmayan parçalar: {result.invalidTokens.slice(0, 10).join(", ")}{result.invalidTokens.length > 10 ? " …" : ""}</p>
      ) : null}
    </section>
  );
}
