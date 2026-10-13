import { EXTENSION_INSTALL_PATH, EXTENSION_LEGAL_NOTE } from "@/lib/listing-control/worker/extension-copy";
import { CLASSIFICATION_LABEL, HEALTH_LABEL, PORTAL_LABEL, RUN_STATE_LABEL, reasonLabel } from "@/lib/listing-control/worker/extension-labels";
import { sanitizeSettings } from "@/lib/listing-control/worker/extension-settings";
import type { RunState } from "@/lib/listing-control/worker/extension-status-view";
import { allPortalHosts, listHtmlAdapters } from "@/lib/listing-control/adapters/html";
import type { StoreItem } from "@/lib/listing-control/adapters/html";
import { applyActionsInPage, attachPhotosInPage, collectControlsInPage, readListHtmlInPage, readPageRefInPage, readValuesInPage } from "@/lib/portal-transfer/page-fns";
import { mergeApplyResults, planFill, summarizeReport, type ControlDescriptor, type FieldReport, type FillPlan } from "@/lib/portal-transfer/fill-plan";
import { anchorIndex, formFingerprint, formShapes, sigIndex, signShapes, type SignedShape } from "@/lib/portal-transfer/form-signature";
import { pickPlan, resolveRules } from "@/lib/portal-transfer/rules-engine";
import { verifyEnvelope } from "@/lib/portal-transfer/rules-verify";
import type { StoredRules } from "@/lib/portal-transfer/rules-store";
import { seedRuleSet } from "@/lib/portal-transfer/seed-rules";
import type { RuleSet } from "@/lib/portal-transfer/rule-format";
import { buildSnapshot, correctionSummary, diffSnapshot, idxsToRead, mergeSnapshots, releaseOwned, resolveSnapshotIdx, untouchedOwnIdxs, type FieldOutcome, type FillSnapshot } from "@/lib/portal-transfer/correction";
import { buildFeedback } from "@/lib/portal-transfer/feedback-build";
import { FEEDBACK_CONSENT_TEXT_VERSION, type FeedbackPhase } from "@/lib/portal-transfer/feedback-format";
import { extractListingRef, parseListingInput } from "@/lib/portal-transfer/listing-ref";
import type { PortalPayload } from "@/lib/portal-transfer/payload";
import type { StoredTransfer } from "@/lib/portal-transfer/ext-queue";
import { photoSummary } from "@/lib/portal-transfer/photo-prep";
import { parsePriceText } from "@/lib/listing-control/adapters/inventory-csv";
import { extractListing, type PageSnapshot } from "@/lib/prospecting/extension-extract";
import type { FeedbackConsent, StatusReply } from "./messages";

/**
 * AÇILIR PENCERE (premium, Türkçe). Tek anahtar: Bağlan → Başlat/Duraklat. Gösterir: bağlantı durumu, sıradaki kontrol,
 * bugün/haftalık sayı, saatlik/günlük hız limiti göstergesi, portal bazında sağlık (yeşil/sarı/kırmızı), "kontrol edilemedi"
 * nedenleri, son sonuçlar ve ayarlar (portal aç/kapa, çalışma saatleri, günlük üst sınır). Sayfa içeriği yalnız
 * `textContent` ile yazılır (HTML enjeksiyonu yok).
 */

declare const __EMLAKSOFT_APP_ORIGIN__: string;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

function nextLabel(s: StatusReply, now: number): string {
  if (s.state === "running") return s.nextAt !== null && s.nextAt - now > 1_500 ? `${Math.ceil((s.nextAt - now) / 1000)} sn` : "Şimdi";
  if (s.state === "cooldown" && s.nextAt) return `${Math.ceil((s.nextAt - now) / 60_000)} dk`;
  if ((s.state === "outside_hours" || s.state === "hour_cap") && s.nextAt) return clock(s.nextAt);
  return "-";
}

const TONE: Record<RunState, "ok" | "warn" | "bad" | ""> = {
  disconnected: "",
  paused: "warn",
  login_required: "warn",
  cooldown: "bad",
  outside_hours: "warn",
  day_cap: "warn",
  hour_cap: "warn",
  waiting_app: "warn",
  running: "ok",
};

function heroSub(s: StatusReply, now: number): string {
  switch (s.state) {
    case "disconnected":
      return "Eklenti bağlanana kadar hiçbir ilan kontrol edilmez. “Bağlan”a basın.";
    case "paused":
      return "Hiçbir ilan kontrol edilmiyor. Anahtarı açınca devam eder.";
    case "login_required":
      return "EmlakSoft’ta oturum açık değil ya da yetkiniz yok. Giriş yapın, otomatik devam eder.";
    case "cooldown":
      return `Portal doğrulama/hız sınırı gösterdi; ${Math.max(1, Math.ceil((s.cooldownUntil - now) / 60_000))} dk beklenecek (aşılmaz).`;
    case "outside_hours":
      return `Çalışma saatleri ${s.workingHours}; açılışta kaldığı yerden sürer.`;
    case "day_cap":
      return `Bugünkü üst sınıra (${s.dayCap}) ulaşıldı; yarın devam eder.`;
    case "hour_cap":
      return "Saatlik 60 kontrol sınırına ulaşıldı; kısa süre sonra devam eder.";
    case "waiting_app":
      return "EmlakSoft sekmesi açık değil. Bir EmlakSoft sekmesi açıkken ilanlar sırayla kontrol edilir.";
    case "running":
      return "EmlakSoft açık: ilanlar düşük hızla, sırayla kontrol ediliyor.";
  }
}

function meter(barId: string, labelId: string, used: number, cap: number, suffix: string) {
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const bar = $(barId);
  bar.style.width = `${pct}%`;
  bar.className = pct >= 80 ? "hot" : "";
  $(labelId).textContent = `${used} / ${cap} ${suffix}`;
}

let settingsDirty = false;

function renderSettings(s: StatusReply) {
  if (settingsDirty) return;
  const toggles = $("portalToggles");
  toggles.replaceChildren();
  for (const p of s.portals) {
    const label = el("label", "field");
    const box = el("input");
    box.type = "checkbox";
    // Yerel ayar yalnız daraltır: ofisin üye olmadığı (ya da kontrolü kapattığı) portal seçilemez.
    box.checked = p.localOn ?? p.enabled;
    box.disabled = p.member === false;
    box.dataset.portal = p.id;
    box.addEventListener("change", () => (settingsDirty = true));
    label.append(box, el("span", "", `${PORTAL_LABEL[p.id] ?? p.id}${p.member === false ? " (ofis üye değil / kontrol kapalı)" : ""}`));
    toggles.append(label);
  }
  const from = $<HTMLSelectElement>("hoursFrom");
  const to = $<HTMLSelectElement>("hoursTo");
  if (from.options.length === 0) {
    for (let h = 0; h <= 23; h += 1) from.add(new Option(`${String(h).padStart(2, "0")}:00`, String(h)));
    for (let h = 1; h <= 24; h += 1) to.add(new Option(`${String(h % 24).padStart(2, "0")}:00`, String(h)));
    for (const node of [from, to, $("hoursEnabled"), $("dailyCap")]) node.addEventListener("change", () => (settingsDirty = true));
  }
  from.value = String(s.settings.hours.from);
  to.value = String(s.settings.hours.to);
  $<HTMLInputElement>("hoursEnabled").checked = s.settings.hours.enabled;
  $<HTMLInputElement>("dailyCap").value = String(s.settings.dailyCap);
}

const SCAN_RESULT: Record<string, string> = {
  complete: "Tam liste okundu",
  partial: "Liste eksik kaldı",
  unreadable: "Sayfa ayrıştırılamadı",
  blocked: "Portal engelledi, durdu",
};

function dayTime(ms: number, now: number): string {
  const d = new Date(ms);
  const same = d.toDateString() === new Date(now).toDateString();
  return `${same ? "bugün" : d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" })} ${clock(ms)}`;
}

/** Günlük mağaza taraması: portal başına son tam tarama, okunan/beklenen ilan sayısı ve sonuç (dürüst durum). */
function renderScan(s: StatusReply, now: number) {
  const scan = s.scan;
  const list = $("scan");
  list.replaceChildren();
  const btn = $<HTMLButtonElement>("scanNow");
  btn.disabled = !s.connected || s.paused || scan?.active === true;
  btn.textContent = scan?.active ? "Taranıyor…" : "Şimdi tara";
  $("scanHint").textContent = !scan
    ? "Bu sürüm günlük tarama bilgisi vermiyor."
    : scan.pendingUploads > 0
      ? `${scan.pendingUploads} sonuç EmlakSoft’a gönderilmeyi bekliyor (bir EmlakSoft sekmesi açın).`
      : "Tarayıcı açıldıktan sonra günde en az bir kez ofisinizin kendi ilan listesi okunur.";
  for (const p of scan?.portals ?? []) {
    const li = el("li", "row");
    const name = el("div", "name");
    name.append(el("span", "", PORTAL_LABEL[p.id] ?? p.id));
    const parts: string[] = [];
    if (p.lastFullAt) parts.push(`Son tam tarama ${dayTime(p.lastFullAt, now)} · ${p.lastRead} ilan`);
    else if (p.lastTryAt) parts.push(`Son deneme ${dayTime(p.lastTryAt, now)}: ${SCAN_RESULT[p.lastResult ?? ""] ?? "-"}`);
    else parts.push("Henüz taranmadı");
    if (p.lastFullAt && p.lastResult && p.lastResult !== "complete") parts.push(SCAN_RESULT[p.lastResult] ?? "");
    name.append(el("small", "", parts.join(" · ")));
    li.append(name);
    list.append(li);
  }
}

function render(s: StatusReply) {
  const now = Date.now();
  $("version").textContent = `Sürüm ${s.version}`;
  $("parser").textContent = `Ayrıştırıcı ${s.parserVersion}`;
  const tone = TONE[s.state];
  const pill = $("pill");
  pill.textContent = RUN_STATE_LABEL[s.state];
  pill.className = `pill ${tone}`;
  $("hero").className = `hero ${tone}`;
  $("heroTitle").textContent = s.state === "running" ? "Çalışıyor" : RUN_STATE_LABEL[s.state];
  $("heroSub").textContent = heroSub(s, now);

  const sw = $<HTMLButtonElement>("switch");
  sw.disabled = !s.connected;
  sw.setAttribute("aria-checked", String(s.connected && !s.paused));
  sw.setAttribute("aria-label", s.paused ? "Kontrolü başlat" : "Kontrolü duraklat");

  const cta = $<HTMLButtonElement>("cta");
  cta.hidden = false;
  cta.className = "cta";
  if (!s.connected) {
    cta.textContent = "Bağlan";
    cta.dataset.action = "connect";
  } else if (s.state === "login_required" || s.state === "waiting_app") {
    cta.textContent = "EmlakSoft’u aç";
    cta.dataset.action = "open";
  } else {
    cta.hidden = true;
  }

  $("disconnect").hidden = !s.connected;
  $("today").textContent = String(s.today);
  $("week").textContent = String(s.week);
  $("next").textContent = nextLabel(s, now);
  meter("hourBar", "hourLbl", s.hourUsed, s.hourCap, "kontrol / saat");
  meter("dayBar", "dayLbl", s.today, s.dayCap, "kontrol / gün");

  renderScan(s, now);

  const portals = $("portals");
  portals.replaceChildren();
  for (const p of s.portals) {
    const li = el("li", "row");
    li.append(el("span", `dot ${p.enabled ? (p.level === "idle" ? "" : p.level) : ""}`));
    const name = el("div", "name");
    name.append(el("span", "", PORTAL_LABEL[p.id] ?? p.id));
    const detail = !p.enabled ? "Kapalı" : p.total === 0 ? HEALTH_LABEL.idle : `${HEALTH_LABEL[p.level]} · son ${p.total} kontrolde ${p.unreadable} okunamadı`;
    name.append(el("small", "", detail));
    li.append(name);
    portals.append(li);
  }

  const reasons = $("reasons");
  reasons.replaceChildren();
  $("reasonsWrap").hidden = s.reasons.length === 0;
  for (const r of s.reasons) {
    const li = el("li", "row");
    li.append(el("span", "name", reasonLabel(r.code)), el("span", "tag", `${r.count}×`));
    reasons.append(li);
  }

  const recent = $("recent");
  recent.replaceChildren();
  if (s.recent.length === 0) recent.append(el("li", "empty", "Henüz kontrol yok."));
  for (const r of s.recent.slice(0, 6)) {
    const li = el("li", "row");
    const name = el("div", "name");
    name.append(el("span", "", `${PORTAL_LABEL[r.portal] ?? r.portal}${r.externalId ? ` · ${r.externalId}` : ""}`));
    name.append(el("small", "", `${clock(r.at)}${r.error ? ` · ${reasonLabel(r.error)}` : ""}`));
    li.append(name, el("span", `tag ${r.kind}`, CLASSIFICATION_LABEL[r.kind]));
    recent.append(li);
  }
  renderSettings(s);
}

async function call(msg: unknown): Promise<StatusReply | null> {
  return chrome.runtime.sendMessage<StatusReply>(msg).catch(() => null);
}

async function refresh() {
  const s = await call({ kind: "status" });
  if (s) render(s);
}

$("legal").textContent = EXTENSION_LEGAL_NOTE;

$("switch").addEventListener("click", async () => {
  const on = $("switch").getAttribute("aria-checked") === "true";
  const s = await call({ kind: "setPaused", paused: on });
  if (s) render(s);
});

$("cta").addEventListener("click", async () => {
  if ($("cta").dataset.action === "connect") {
    const s = await call({ kind: "setConnected", connected: true });
    if (s) render(s);
    return;
  }
  void chrome.tabs.create({ url: `${__EMLAKSOFT_APP_ORIGIN__}/app/ilan-kontrol` });
});

$("save").addEventListener("click", async () => {
  const portals: Record<string, boolean> = {};
  for (const box of Array.from(document.querySelectorAll<HTMLInputElement>("#portalToggles input[data-portal]"))) {
    portals[box.dataset.portal as string] = box.checked;
  }
  const settings = sanitizeSettings({
    portals,
    hours: {
      enabled: $<HTMLInputElement>("hoursEnabled").checked,
      from: Number($<HTMLSelectElement>("hoursFrom").value),
      to: Number($<HTMLSelectElement>("hoursTo").value),
    },
    dailyCap: Number($<HTMLInputElement>("dailyCap").value),
  });
  settingsDirty = false;
  const s = await call({ kind: "saveSettings", settings });
  if (s) render(s);
});

$("scanNow").addEventListener("click", async () => {
  const s = await call({ kind: "scanNow" });
  if (s) render(s);
});

$("disconnect").addEventListener("click", async () => {
  const s = await call({ kind: "setConnected", connected: false });
  if (s) render(s);
});

$("help").addEventListener("click", () => {
  void chrome.tabs.create({ url: `${__EMLAKSOFT_APP_ORIGIN__}${EXTENSION_INSTALL_PATH}` });
});

void refresh();
setInterval(() => void refresh(), 5_000);

// ---------------------------------------------------------------- (0.4.0) EmlakSoft'a sahibinden ilan olarak kaydet
// Yalnız kullanıcı simgeye/düğmeye tıkladığında ve yalnız AÇIK sekmede çalışır (activeTab): arka planda gezinme/izleme yok.
// Açıklama metni ve fotoğraf alınmaz; "numarayı göster" düğmesine BASILMAZ. Kullanıcı alanları düzenler ve onaylar.

/** Sayfa bağlamında çalışır (serileştirilir): kendi içinde tamamdır, dışarıya başvurmaz. */
function captureSnapshot(): PageSnapshot {
  const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
  const meta = (sel: string) => (document.querySelector(sel) as HTMLMetaElement | null)?.content ?? "";
  return {
    url: location.href,
    title: document.title,
    h1: text(document.querySelector("h1")),
    jsonLd: Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .slice(0, 3)
      .map((s) => (s.textContent ?? "").slice(0, 20000)),
    metaPrice: meta('meta[property="product:price:amount"]') || meta('meta[property="og:price:amount"]'),
    text: (document.body?.innerText ?? "").slice(0, 30000),
    crumbs: Array.from(document.querySelectorAll(".classifiedInfo h2 a, .breadcrumb a, nav[aria-label*='readcrumb'] a"))
      .slice(0, 6)
      .map((a) => text(a)),
    telLinks: Array.from(document.querySelectorAll('a[href^="tel:"]'))
      .slice(0, 3)
      .map((a) => a.getAttribute("href") ?? ""),
    ownerName: text(document.querySelector(".username-info-area h5, .user-info-module .username-info-area, .storeInfo h5")),
  };
}

/** Portal sekmesine betik enjekte eden TEK geçit: yalnız kullanıcı tıklamasıyla, etkin sekmede (activeTab). Arka planda hiçbir sayfa okunmaz. */
function runInTab<T, A extends unknown[]>(tabId: number, func: (...args: A) => T, ...args: A) {
  return chrome.scripting.executeScript({ target: { tabId }, func, args });
}

const PORTAL_HOSTS = allPortalHosts();
let activeTabId: number | null = null;
let activeUrl = "";

type FsboInfo = { last?: { summary?: string; at?: number } | null; pending?: number } | null;

function isPortalUrl(raw: string | undefined): boolean {
  try {
    const host = new URL(raw ?? "").hostname.toLowerCase();
    return PORTAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

async function initFsbo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  if (!tab?.id || !isPortalUrl(tab.url)) return;
  activeTabId = tab.id;
  activeUrl = tab.url ?? "";
  $("fsbo").hidden = false;
  const info = (await call({ kind: "fsboLast" }).catch(() => null)) as unknown as FsboInfo;
  if (info?.pending) $("fsboResult").textContent = `${info.pending} kayıt EmlakSoft'a gönderilmeyi bekliyor (bir EmlakSoft sekmesi açın).`;
  else if (info?.last?.summary) $("fsboResult").textContent = `Son kayıt: ${info.last.summary}`;
}

$("fsboRead").addEventListener("click", async () => {
  if (activeTabId === null) return;
  $("fsboResult").textContent = "";
  try {
    const [out] = await runInTab(activeTabId, captureSnapshot);
    const snap = out?.result;
    if (!snap) throw new Error("empty");
    const x = extractListing(snap);
    $<HTMLInputElement>("fsboTitle").value = x.title ?? "";
    $<HTMLInputElement>("fsboPrice").value = x.price ? String(x.price) : "";
    $<HTMLInputElement>("fsboRooms").value = x.rooms ?? "";
    $<HTMLInputElement>("fsboM2").value = x.grossM2 ? String(x.grossM2) : "";
    $<HTMLInputElement>("fsboLoc").value = x.locationText ?? "";
    $<HTMLInputElement>("fsboOwner").value = x.ownerName ?? "";
    $<HTMLInputElement>("fsboPhone").value = x.phoneCandidate ?? "";
    $<HTMLInputElement>("fsboPhoneOk").checked = false;
    $("fsboForm").dataset.url = x.url;
    $("fsboForm").dataset.listedAt = x.listedAt ?? "";
    $("fsboForm").dataset.tx = x.transactionType;
    $("fsboForm").hidden = false;
    $("fsboHint").textContent = "Alanları kontrol edin; okunamayanı elle yazabilirsiniz.";
  } catch {
    $("fsboResult").textContent = "Sayfa okunamadı. İlan detay sayfasında olduğunuzdan emin olun; alanları elle de girebilirsiniz.";
    $("fsboForm").dataset.url = activeUrl.split(/[?#]/)[0];
    $("fsboForm").hidden = false;
  }
});

$("fsboForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = $("fsboForm");
  const phone = $<HTMLInputElement>("fsboPhone").value.trim();
  if (phone && !$<HTMLInputElement>("fsboPhoneOk").checked) {
    $("fsboResult").textContent = "Telefonu eklemek için “numarayı ilanda kendim gördüm” kutusunu işaretleyin ya da numarayı silin.";
    return;
  }
  const payload = {
    url: form.dataset.url ?? "",
    title: $<HTMLInputElement>("fsboTitle").value,
    price: parsePriceText($<HTMLInputElement>("fsboPrice").value),
    rooms: $<HTMLInputElement>("fsboRooms").value,
    grossM2: parsePriceText($<HTMLInputElement>("fsboM2").value),
    locationText: $<HTMLInputElement>("fsboLoc").value,
    listedAt: form.dataset.listedAt || null,
    transactionType: form.dataset.tx === "rent" ? "rent" : "sale",
    ownerName: $<HTMLInputElement>("fsboOwner").value,
    phone: phone || null,
  };
  const res = (await call({ kind: "fsboPut", payload })) as unknown as { ok?: boolean } | null;
  if (!res?.ok) {
    $("fsboResult").textContent = "Kayıt eklenemedi: ilan bağlantısı ya da alanlar geçersiz.";
    return;
  }
  form.hidden = true;
  $("fsboResult").textContent = "Kayıt kuyruğa alındı. Bir EmlakSoft sekmesi açıksa otomatik gönderilir; değilse EmlakSoft'u açın.";
  // Gönderim özeti birkaç saniye içinde gelirse göster.
  for (let i = 0; i < 6; i += 1) {
    await new Promise((r) => setTimeout(r, 1_000));
    const info = (await call({ kind: "fsboLast" })) as unknown as FsboInfo;
    if (info && !info.pending && info.last?.summary) {
      $("fsboResult").textContent = info.last.summary;
      break;
    }
  }
});

void initFsbo();

// ---------------------------------------------------------------- (0.5.0) Portala aktar + Portaldaki ilanlarımı al
// Her ikisi de YALNIZ popup düğmesine basılınca, etkin portal sekmesinde çalışır. Eklenti formu doldurur; "Yayınla"ya, kategori ve
// konum seçimine kullanıcı basar. Parola/e-posta/telefon/dosya (fotoğraf hariç) denetimlerine dokunulmaz. Portal sayfası değiştirilmez.

type TransferGet = { transfer: StoredTransfer | null; doneLast: { at: number; ok: boolean; summary: string } | null; donePending: number };
type PortalTab = { tabId: number; portal: "sahibinden" | "hepsiemlak" | "emlakjet"; url: string };
let portalTab: PortalTab | null = null;
let loadedTransfer: StoredTransfer | null = null;
let lastReport: FieldReport[] = [];

const STATUS_LABEL: Record<FieldReport["status"], string> = {
  planned: "Dolduruldu",
  already_filled: "Zaten dolu",
  not_found: "Alan bulunamadı",
  no_option: "Seçenek eşleşmedi",
  skipped: "EmlakSoft'ta değer yok",
  manual: "Elle doldurun",
};
const STATUS_TONE: Record<FieldReport["status"], string> = { planned: "ok", already_filled: "", not_found: "warn", no_option: "warn", skipped: "", manual: "warn" };
/** (0.6.0) Uzak (imzalı) kural setiyle doldurulan alanın güven rozeti. Paket içi varsayılanla doldurmada rozet gösterilmez. */
const STATE_BADGE: Record<string, { text: string; tone: string }> = {
  verified: { text: "doğrulanmış", tone: "ok" },
  unverified: { text: "öneri (doğrulanmamış)", tone: "" },
  degraded: { text: "kontrol edin", tone: "warn" },
};

async function transferGet(): Promise<TransferGet> {
  return ((await call({ kind: "transferGet" }).catch(() => null)) as unknown as TransferGet | null) ?? { transfer: null, doneLast: null, donePending: 0 };
}

function renderReport(report: FieldReport[], remoteRules: boolean) {
  const list = $("transferReport");
  list.replaceChildren();
  for (const r of report.filter((x) => x.status !== "skipped")) {
    const li = el("li", "row");
    const name = el("div", "name");
    name.append(el("span", "", r.label));
    if (r.detail) name.append(el("small", "", r.detail));
    const badges = el("div", "badges");
    badges.append(el("span", `tag ${STATUS_TONE[r.status]}`, STATUS_LABEL[r.status]));
    const badge = remoteRules && (r.status === "planned" || r.status === "already_filled") && r.state ? STATE_BADGE[r.state] : undefined;
    if (badge) badges.append(el("span", `tag ${badge.tone}`, badge.text));
    li.append(name, badges);
    list.append(li);
  }
}

function renderManual(payload: PortalPayload, report: FieldReport[]) {
  const wrap = $("transferManualWrap");
  const list = $("transferManual");
  list.replaceChildren();
  const rows: { label: string; value: string }[] = [];
  for (const m of payload.manual) rows.push({ label: m.label, value: m.value ?? "Portalda siz seçin" });
  for (const r of report) if (r.status === "not_found" || r.status === "no_option" || r.status === "manual") rows.push({ label: r.label, value: r.detail ?? "" });
  if (!payload.eids.propertyNo) rows.push({ label: "EİDS taşınmaz numarası", value: "Portföyde yok; mal sahibinden alıp portala girin" });
  if (payload.eids.warning) rows.push({ label: "Yetki durumu", value: payload.eids.warning });
  wrap.hidden = rows.length === 0;
  for (const r of rows) {
    const li = el("li", "row");
    const name = el("div", "name");
    name.append(el("span", "", r.label), el("small", "", r.value));
    li.append(name);
    list.append(li);
  }
}

async function renderTransfer() {
  if (!portalTab) return;
  const info = await transferGet();
  loadedTransfer = info.transfer;
  const t = info.transfer;
  const fill = $<HTMLButtonElement>("transferFill");
  if (!t) {
    $("transferHint").textContent = "EmlakSoft'ta portföyün “Yayın ve portallar” sekmesinden “Portala aktar”a basın; sonra buraya dönüp doldurun.";
    fill.disabled = true;
  } else if (t.portal !== portalTab.portal) {
    $("transferHint").textContent = `Hazır paket başka portal için (${PORTAL_LABEL[t.portal] ?? t.portal}). EmlakSoft'tan bu portal için yeniden “Portala aktar” deyin.`;
    fill.disabled = true;
  } else {
    const payload = t.payload as PortalPayload;
    $("transferHint").textContent = `Hazır: ${t.propertyCode} · ${t.propertyTitle} — ${Object.keys(payload.fields).length} alan, ${t.photoIds.length} fotoğraf. Portalın “İlan ver” formunu açıp kategoriyi seçtikten sonra doldurun.`;
    fill.disabled = false;
    $("transferPhotos").textContent = t.photoIds.length > 0 ? photoSummary(t.photosStored, t.photoIds.length) : "";
    $("transferBind").hidden = false;
  }
  if (info.doneLast) $("transferResult").textContent = info.doneLast.summary;
  else if (info.donePending > 0) $("transferResult").textContent = "Bağlama EmlakSoft'a gönderilmeyi bekliyor (bir EmlakSoft sekmesi açın).";
}

/** Fotoğrafları bellekten alıp (en çok 6'şarlı gruplarla) dosya alanına koyar; başaramazsa dürüst yönlendirme gösterir. */
async function attachPhotos(t: StoredTransfer): Promise<void> {
  const total = t.photoIds.length;
  if (total === 0 || !portalTab) return;
  const retry = $("transferPhotoRetry");
  const open = $("transferPhotoOpen");
  retry.hidden = true;
  open.hidden = true;
  const files: { name: string; type: string; b64: string }[] = [];
  for (let from = 0; from < total; from += 4) {
    const got = (await call({ kind: "transferPhotos", from, count: 4 }).catch(() => null)) as unknown as { photos?: ({ name: string; type: string; b64: string } | null)[] } | null;
    for (const ph of got?.photos ?? []) if (ph) files.push(ph);
  }
  if (files.length === 0) {
    $("transferPhotos").textContent = "Fotoğraflar eklenti belleğinde yok (tarayıcı yeniden başlamış olabilir). EmlakSoft'tan yeniden “Portala aktar” deyin ya da fotoğrafları elle ekleyin.";
    open.hidden = false;
    return;
  }
  let attached = 0;
  let reason = "";
  for (let i = 0; i < files.length; i += 6) {
    const [out] = await runInTab(portalTab.tabId, attachPhotosInPage, files.slice(i, i + 6)).catch(() => []);
    const r = out?.result;
    if (!r?.ok) {
      reason = r?.reason ?? "error";
      break;
    }
    attached += r.attached;
    if (r.reason === "single_input") {
      reason = "single_input";
      break;
    }
  }
  if (attached === files.length) $("transferPhotos").textContent = `${attached} fotoğraf forma eklendi; portalın yüklemesini kontrol edin.`;
  else {
    $("transferPhotos").textContent =
      reason === "no_file_input"
        ? "Portalda fotoğraf alanı bu adımda yok. Fotoğraf adımına geçince “Fotoğrafları yeniden dene”ye basın."
        : `Fotoğrafların ${attached}/${files.length} kadarı otomatik eklenebildi (${reason === "single_input" ? "alan tek dosya kabul ediyor" : "portal sürükle-bırak istiyor olabilir"}). Kalanları EmlakSoft'tan indirip elle ekleyin.`;
    retry.hidden = false;
    open.hidden = false;
  }
}

// ---- (0.6.0) Öğrenen kurallar + form şeması + düzeltme sinyali (yalnız açık rızayla gönderilir)

type LoadedRules = { set: RuleSet; sha: string | null; remote: boolean; note: string };
let lastPlan: FillPlan | null = null;
let consent: FeedbackConsent | null = null;
/** Rıza kartı doldurmadan SONRA onaylanırsa o doldurmanın şeması bir kez gönderilir. */
let pendingFilledFeedback: (() => void) | null = null;

const CONSENT_TEXT =
  "EmlakSoft'un portal formlarını daha iyi tanıması için doldurduğunuz formun alan şemasını (alan adı, türü, portalın kendi seçenekleri) ve hangi alanı düzelttiğinizi (değeri değil, yalnız düzeltmenin türünü) anonim olarak gönderebiliriz. Yazdığınız değerler, iletişim alanları ve kişisel bilgiler gönderilmez. Bu şema bilgisi, eşleştirme önerisi üretmek için yapay zekâ hizmet sağlayıcımızla maskelenmiş olarak paylaşılabilir. İstediğiniz zaman Ayarlar'dan kapatabilirsiniz; kapatınca bekleyen kayıtlar da silinir.";

const consentGranted = () => consent?.granted === true && consent.textVersion === FEEDBACK_CONSENT_TEXT_VERSION;
const consentUndecided = () => !consent || consent.textVersion !== FEEDBACK_CONSENT_TEXT_VERSION;

async function loadConsent(): Promise<void> {
  const r = (await call({ kind: "consentGet" }).catch(() => null)) as unknown as { consent?: FeedbackConsent | null } | null;
  consent = r?.consent ?? null;
  $<HTMLInputElement>("feedbackConsent").checked = consentGranted();
}

async function setConsent(granted: boolean): Promise<void> {
  const r = (await call({ kind: "consentSet", granted }).catch(() => null)) as unknown as { consent?: FeedbackConsent } | null;
  if (r?.consent) consent = r.consent;
  $("consentCard").hidden = true;
  $<HTMLInputElement>("feedbackConsent").checked = consentGranted();
  const pending = pendingFilledFeedback;
  pendingFilledFeedback = null;
  if (consentGranted() && pending) pending();
}

$("consentText").textContent = CONSENT_TEXT;
$("consentSettingText").textContent = CONSENT_TEXT;
$("consentYes").addEventListener("click", () => void setConsent(true));
$("consentNo").addEventListener("click", () => void setConsent(false));
$("feedbackConsent").addEventListener("change", () => void setConsent($<HTMLInputElement>("feedbackConsent").checked));
void loadConsent();

/**
 * Depodaki imzalı seti alır ve KULLANMADAN ÖNCE yeniden doğrular (imza + katı şema + süre + kurulu sürüm). Herhangi bir
 * sorun ya da kullanıcı "varsayılan" dediyse pakete gömülü tohum kullanılır.
 */
async function loadRules(portal: PortalTab["portal"], forceSeed: boolean): Promise<LoadedRules> {
  const seed = seedRuleSet(portal);
  if (forceSeed) return { set: seed, sha: null, remote: false, note: "Paket içi varsayılan eşleştirme kullanıldı." };
  const got = (await call({ kind: "rulesGet", portal }).catch(() => null)) as unknown as { entry?: StoredRules | null } | null;
  const entry = got?.entry ?? null;
  if (!entry?.envelope) return { set: seed, sha: null, remote: false, note: "Eşleştirme kuralları: paket içi varsayılan." };
  const verified = await verifyEnvelope(entry.envelope).catch(() => ({ ok: false as const }));
  const r = verified.ok ? resolveRules(entry.envelope.rules, seed, { nowMs: Date.now(), installedVersion: chrome.runtime.getManifest().version }) : null;
  if (!r || r.source === "seed") return { set: seed, sha: null, remote: false, note: "Güncel kurallar doğrulanamadı ya da süresi doldu; paket içi varsayılan kullanıldı." };
  return { set: r.set, sha: entry.sha256, remote: true, note: `Eşleştirme kuralları: sürüm ${r.set.version} (imzalı).` };
}

async function pageShapes(descs: readonly ControlDescriptor[]): Promise<{ signed: SignedShape[]; fp: string }> {
  const signed = await signShapes(formShapes(descs).shapes);
  return { signed, fp: await formFingerprint(signed) };
}

async function getSnapshot(): Promise<FillSnapshot | null> {
  const r = (await call({ kind: "snapshotGet" }).catch(() => null)) as unknown as { snapshot?: FillSnapshot | null } | null;
  return r?.snapshot ?? null;
}

async function fillFromEmlakSoft(forceSeed: boolean): Promise<void> {
  if (!portalTab || !loadedTransfer || loadedTransfer.portal !== portalTab.portal) return;
  const tab = portalTab;
  const transfer = loadedTransfer;
  const payload = transfer.payload as PortalPayload;
  $("transferResult").textContent = "";
  $("transferFormWarn").hidden = true;
  try {
    const rules = await loadRules(tab.portal, forceSeed);
    const [scan] = await runInTab(tab.tabId, collectControlsInPage);
    const descriptors = scan?.result ?? [];
    if (descriptors.length === 0) throw new Error("empty");
    const { signed, fp } = await pageShapes(descriptors);
    const anchors = anchorIndex(signed);
    // Yeniden doldurma (ör. K3 "varsayılanla yeniden doldur"): önceki turun yazdığı ve kullanıcının dokunmadığı alanlar
    // plan için boş sayılır, böylece yanlış doldurulmuş alan düzeltilebilir. Kullanıcının yazdığı/değiştirdiği alana dokunulmaz.
    const prevSnap = await getSnapshot();
    let owned: number[] = [];
    if (prevSnap && prevSnap.sessionId === transfer.sessionId && prevSnap.portal === tab.portal && prevSnap.items.length > 0) {
      const shapesNow = sigIndex(signed);
      const toRead = idxsToRead(resolveSnapshotIdx(prevSnap, shapesNow));
      const [prevRead] = toRead.length > 0 ? await runInTab(tab.tabId, readValuesInPage, toRead).catch(() => []) : [];
      owned = untouchedOwnIdxs(prevSnap, prevRead?.result ?? [], { shapes: shapesNow, descs: descriptors });
    }
    const planDescs = owned.length > 0 ? releaseOwned(descriptors, owned) : descriptors;
    const seedPlan = planFill(planDescs, payload, seedRuleSet(tab.portal), { anchors });
    let plan = seedPlan;
    if (rules.remote) {
      try {
        plan = pickPlan(planFill(planDescs, payload, rules.set, { ruleSha: rules.sha, anchors }), seedPlan);
      } catch {
        plan = { ...seedPlan, rulesRegressed: true };
      }
    }
    const remoteUsed = plan.ruleVersion > 0;
    const [applied] = plan.actions.length > 0 ? await runInTab(tab.tabId, applyActionsInPage, plan.actions) : [];
    const appliedRes = applied?.result ?? [];
    lastReport = mergeApplyResults(plan, appliedRes);
    lastPlan = { ...plan, report: lastReport };
    renderReport(lastReport, remoteUsed);
    renderManual(payload, lastReport);
    $("transferRules").textContent = plan.rulesRegressed ? "Güncel kurallar bu formda daha az alan buldu; bu doldurmada paket içi varsayılan kullanıldı." : rules.note;
    $("transferFormWarn").hidden = !(rules.remote && rules.set.fingerprints.length > 0 && !rules.set.fingerprints.includes(fp));
    $("transferSeedFill").hidden = !remoteUsed;
    const sum = summarizeReport(lastReport);
    // Önceki turun yazıp bu turun hedeflemediği alanlar olduğu gibi kalır (silinmez): kullanıcıya söylenir.
    const targeted = new Set(plan.report.flatMap((r) => (r.idx === undefined ? [] : [r.idx])));
    const leftover = owned.filter((i) => !targeted.has(i)).length;
    $("transferResult").textContent =
      `${sum.filled} alan dolduruldu, ${sum.manual} alanı elle doldurmanız gerekiyor. Kontrol edip “Yayınla”ya siz basın.` +
      (leftover > 0 ? ` Önceki doldurmadan kalan ${leftover} alan değiştirilmedi; bu alanları kontrol edin.` : "");
    $("transferBind").hidden = false;

    // Anlık görüntü (oturum deposu): doldurulan alanların ŞİMDİKİ durumunun özeti; ham değer sayfadan çıkmaz.
    const filled = Array.from(new Set(plan.actions.map((a) => a.idx)));
    const [read] = filled.length > 0 ? await runInTab(tab.tabId, readValuesInPage, filled).catch(() => []) : [];
    const fresh = buildSnapshot(
      { sessionId: transfer.sessionId, portal: tab.portal, ruleVersion: plan.ruleVersion, ruleSha: plan.ruleSha, at: Date.now() },
      plan.actions,
      appliedRes,
      read?.result ?? [],
      sigIndex(signed),
      descriptors,
    );
    // Birleştirilir (üzerine yazılmaz): ilk turda doldurulan alanların düzeltme takibi kaybolmasın.
    const snapshot = mergeSnapshots(prevSnap, fresh, sigIndex(signed));
    await call({ kind: "snapshotPut", snapshot });
    $("transferCheck").hidden = snapshot.items.length === 0;

    // Form şeması (rıza varsa; ilk doldurmada rıza kartı gösterilir, onaylanırsa bu doldurmanın şeması o an gider).
    const filledPlan = lastPlan;
    const sendFilled = () => {
      const fb = buildFeedback({ sessionId: transfer.sessionId, portal: tab.portal, phase: "filled", plan: filledPlan, descs: descriptors, signed, formFp: fp, values: payload.fields });
      if (fb.payload) void call({ kind: "feedbackPut", payload: fb.payload });
    };
    if (consentGranted()) sendFilled();
    else if (consentUndecided()) {
      pendingFilledFeedback = sendFilled;
      $("consentCard").hidden = false;
    }

    await attachPhotos(transfer);
    const report: Record<string, string> = {};
    for (const r of lastReport) report[r.key] = r.status;
    void call({ kind: "transferDonePut", payload: { sessionId: transfer.sessionId, portal: tab.portal, state: "filled", externalId: null, url: null, report } });
    // Yayınlanmış ilan sayfasındaysa numarayı önceden doldur.
    const [ref] = await runInTab(tab.tabId, readPageRefInPage).catch(() => []);
    const found = ref?.result ? extractListingRef(ref.result) : null;
    if (found && !$<HTMLInputElement>("transferListing").value) $<HTMLInputElement>("transferListing").value = found.url ?? found.externalId;
  } catch {
    $("transferResult").textContent = "Form okunamadı. Portalın “İlan ver” formunun açık olduğundan ve kategori adımını geçtiğinizden emin olun.";
  }
}

/**
 * Doldurmadan sonraki durumu okur ve anlık görüntüyle karşılaştırır (alan yeniden çizildiyse imzasıyla bulunur). Rıza varsa
 * sonuç türleri (değer DEĞİL) geri bildirim kuyruğuna girer. Anlık görüntü yoksa null.
 */
async function checkCorrections(phase: Exclude<FeedbackPhase, "filled">): Promise<FieldOutcome[] | null> {
  if (!portalTab || !loadedTransfer) return null;
  const tab = portalTab;
  const snap = await getSnapshot();
  if (!snap || snap.sessionId !== loadedTransfer.sessionId || snap.items.length === 0) return null;
  const [scan] = await runInTab(tab.tabId, collectControlsInPage);
  const descs = scan?.result ?? [];
  const { signed, fp } = await pageShapes(descs);
  const shapes = sigIndex(signed);
  const idxs = idxsToRead(resolveSnapshotIdx(snap, shapes));
  const [read] = idxs.length > 0 ? await runInTab(tab.tabId, readValuesInPage, idxs) : [];
  const outcomes = diffSnapshot(snap, read?.result ?? [], { shapes, descs });
  if (consentGranted()) {
    const fb = buildFeedback({
      sessionId: snap.sessionId,
      portal: tab.portal,
      phase,
      plan: { report: [], unclaimed: [], ruleVersion: snap.ruleVersion, ruleSha: snap.ruleSha ?? null, rulesRegressed: lastPlan?.rulesRegressed },
      descs,
      signed,
      formFp: fp,
      outcomes,
      values: (loadedTransfer.payload as PortalPayload).fields,
    });
    if (fb.payload) await call({ kind: "feedbackPut", payload: fb.payload });
  }
  return outcomes;
}

$("transferFill").addEventListener("click", () => void fillFromEmlakSoft(false));
// Acil durum (K3): kullanıcı uzak kurallar yerine pakete gömülü varsayılanla yeniden doldurabilir. Önceki turun yazdığı ve
// el değmemiş alanlar varsayılanla yeniden yazılır; kullanıcının değiştirdiği alanlara dokunulmaz.
$("transferSeedFill").addEventListener("click", () => void fillFromEmlakSoft(true));

$("transferCheck").addEventListener("click", async () => {
  try {
    const outcomes = await checkCorrections("checked");
    if (!outcomes) {
      $("transferResult").textContent = "Kontrol için önce bu formda “EmlakSoft'tan doldur”u kullanın.";
      return;
    }
    const s = correctionSummary(outcomes);
    const changed = s.changed + s.cleared;
    $("transferResult").textContent =
      (changed === 0 ? `Doldurulan ${s.accepted} alanın hiçbirini değiştirmediniz.` : `${changed} alanı değiştirdiniz (${s.changed} düzeltme, ${s.cleared} boşaltma).`) +
      (s.missing > 0 ? ` ${s.missing} alan sayfada bulunamadı.` : "") +
      " Kontrol edip “Yayınla”ya siz basın.";
  } catch {
    $("transferResult").textContent = "Form okunamadı. Portal sekmesinin açık olduğundan emin olun.";
  }
});

$("transferPhotoRetry").addEventListener("click", () => {
  if (loadedTransfer) void attachPhotos(loadedTransfer);
});

$("transferPhotoOpen").addEventListener("click", () => {
  if (!loadedTransfer) return;
  void chrome.tabs.create({ url: `${__EMLAKSOFT_APP_ORIGIN__}/app/portfoyler/${encodeURIComponent(loadedTransfer.propertyId)}?sekme=medya` });
});

$("transferBind").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!portalTab || !loadedTransfer || loadedTransfer.portal !== portalTab.portal) return;
  let ref = parseListingInput($<HTMLInputElement>("transferListing").value);
  if (!ref) {
    // Alan boşsa açık ilan sayfasından okumayı dener (kullanıcı yayınlanan ilanın sayfasındaysa).
    const [page] = await runInTab(portalTab.tabId, readPageRefInPage).catch(() => []);
    ref = page?.result ? extractListingRef(page.result) : null;
  }
  if (!ref) {
    $("transferResult").textContent = "İlan numarası okunamadı. İlan numarasını (6-12 haneli) ya da ilanın bağlantısını yapıştırın.";
    return;
  }
  // Yayın anındaki son durum: düzeltme sinyali (rıza varsa) "published" fazıyla; anlık görüntü ardından silinir.
  await checkCorrections("published").catch(() => null);
  // Alan raporu GÖNDERİLMEZ: "filled" anındaki rapor sunucuda korunur (boş rapor onu ezerdi).
  const res = (await call({
    kind: "transferDonePut",
    payload: { sessionId: loadedTransfer.sessionId, portal: portalTab.portal, state: "published", externalId: ref.externalId, url: ref.url },
  })) as unknown as { ok?: boolean } | null;
  if (!res?.ok) {
    $("transferResult").textContent = "Kayıt kuyruğa alınamadı.";
    return;
  }
  void call({ kind: "snapshotPut", snapshot: null });
  $("transferCheck").hidden = true;
  $("transferResult").textContent = "Kuyruğa alındı. Bir EmlakSoft sekmesi açıksa otomatik bağlanır; değilse EmlakSoft'u açın.";
  for (let i = 0; i < 8; i += 1) {
    await new Promise((r) => setTimeout(r, 1_000));
    const info = await transferGet();
    if (info.donePending === 0 && info.doneLast && info.doneLast.at > Date.now() - 20_000) {
      $("transferResult").textContent = info.doneLast.summary;
      break;
    }
  }
});

// ---- Portaldaki ilanlarımı al
let importCandidates: StoreItem[] = [];

function renderImportList(items: StoreItem[]) {
  const box = $("importList");
  box.replaceChildren();
  const all = el("label", "pick");
  const allBox = el("input");
  allBox.type = "checkbox";
  allBox.id = "importAll";
  allBox.addEventListener("change", () => {
    for (const c of Array.from(box.querySelectorAll<HTMLInputElement>("input[data-ext-id]"))) c.checked = allBox.checked;
  });
  all.append(allBox, el("span", "", `Tümünü seç (${items.length})`));
  box.append(all);
  for (const it of items) {
    const row = el("label", "pick");
    const cb = el("input");
    cb.type = "checkbox";
    cb.dataset.extId = it.externalId;
    const txt = el("span");
    txt.append(document.createTextNode(it.title ?? `İlan ${it.externalId}`));
    const meta = [it.price ? `${new Intl.NumberFormat("tr-TR").format(it.price)} TL` : "", it.rooms ?? "", it.sqm ? `${it.sqm} m²` : "", it.location ?? "", it.status === "passive" ? "pasif" : "", `#${it.externalId}`]
      .filter(Boolean)
      .join(" · ");
    txt.append(el("small", "", meta));
    row.append(cb, txt);
    box.append(row);
  }
}

$("importRead").addEventListener("click", async () => {
  if (!portalTab) return;
  $("importResult").textContent = "";
  try {
    const adapter = listHtmlAdapters().find((a) => a.id === portalTab?.portal);
    const [out] = await runInTab(portalTab.tabId, readListHtmlInPage);
    const page = out?.result;
    if (!adapter || !page) throw new Error("empty");
    const parsed = adapter.parseStore({ status: 200, finalUrl: page.url, html: page.html });
    importCandidates = parsed.items.slice(0, 100);
    if (importCandidates.length === 0) {
      $("importListWrap").hidden = true;
      $("importResult").textContent = "Bu sayfada ilan listesi okunamadı. Portalın “İlanlarım” sayfasını açıp listenin göründüğünden emin olun.";
      return;
    }
    renderImportList(importCandidates);
    $("importListWrap").hidden = false;
    $("importResult").textContent = `${importCandidates.length} ilan okundu${parsed.nextUrl ? " (sonraki sayfalar için sayfayı değiştirip yeniden okuyun)" : ""}. EmlakSoft'a alacaklarınızı seçin.`;
  } catch {
    $("importResult").textContent = "Sayfa okunamadı. İlanlarım sayfasında olduğunuzdan emin olun.";
  }
});

$("importSend").addEventListener("click", async () => {
  if (!portalTab) return;
  const chosen = new Set(Array.from($("importList").querySelectorAll<HTMLInputElement>("input[data-ext-id]")).filter((c) => c.checked).map((c) => c.dataset.extId as string));
  const items = importCandidates.filter((i) => chosen.has(i.externalId));
  if (items.length === 0) {
    $("importResult").textContent = "Önce EmlakSoft'a almak istediğiniz ilanları seçin.";
    return;
  }
  const res = (await call({
    kind: "importPut",
    payload: {
      portal: portalTab.portal,
      items: items.map((i) => ({ externalId: i.externalId, url: i.url, title: i.title ?? null, price: i.price ?? null, sqm: i.sqm ?? null, rooms: i.rooms ?? null, location: i.location ?? null, status: i.status ?? "active" })),
    },
  })) as unknown as { ok?: boolean } | null;
  if (!res?.ok) {
    $("importResult").textContent = "Seçim kuyruğa alınamadı.";
    return;
  }
  $("importListWrap").hidden = true;
  $("importResult").textContent = `${items.length} ilan kuyruğa alındı. Bir EmlakSoft sekmesi açıksa otomatik eklenir; değilse EmlakSoft'u açın.`;
  for (let i = 0; i < 10; i += 1) {
    await new Promise((r) => setTimeout(r, 1_500));
    const info = (await call({ kind: "importLast" }).catch(() => null)) as unknown as { last?: { at: number; summary: string } | null; pending?: number } | null;
    if (info && !info.pending && info.last && info.last.at > Date.now() - 30_000) {
      $("importResult").textContent = info.last.summary;
      break;
    }
  }
});

async function initPortalTools() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  if (!tab?.id || !tab.url) return;
  const adapter = listHtmlAdapters().find((a) => a.isPortalUrl(tab.url as string));
  if (!adapter) return;
  portalTab = { tabId: tab.id, portal: adapter.id as PortalTab["portal"], url: tab.url };
  $("transfer").hidden = false;
  $("importer").hidden = false;
  await renderTransfer();
  const snap = await getSnapshot();
  $("transferCheck").hidden = !(snap && loadedTransfer && snap.sessionId === loadedTransfer.sessionId && snap.items.length > 0);
  const last = (await call({ kind: "importLast" }).catch(() => null)) as unknown as { last?: { summary: string } | null; pending?: number } | null;
  if (last?.pending) $("importResult").textContent = `${last.pending} kayıt EmlakSoft'a gönderilmeyi bekliyor (bir EmlakSoft sekmesi açın).`;
  else if (last?.last?.summary) $("importResult").textContent = `Son işlem: ${last.last.summary}`;
}

void initPortalTools();
