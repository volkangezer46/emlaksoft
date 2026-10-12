import { EXTENSION_INSTALL_PATH, EXTENSION_LEGAL_NOTE } from "@/lib/listing-control/worker/extension-copy";
import { CLASSIFICATION_LABEL, HEALTH_LABEL, PORTAL_LABEL, RUN_STATE_LABEL, reasonLabel } from "@/lib/listing-control/worker/extension-labels";
import { sanitizeSettings } from "@/lib/listing-control/worker/extension-settings";
import type { RunState } from "@/lib/listing-control/worker/extension-status-view";
import { allPortalHosts } from "@/lib/listing-control/adapters/html";
import { parsePriceText } from "@/lib/listing-control/adapters/inventory-csv";
import { extractListing, type PageSnapshot } from "@/lib/prospecting/extension-extract";
import type { StatusReply } from "./messages";

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
    box.checked = p.enabled;
    box.dataset.portal = p.id;
    box.addEventListener("change", () => (settingsDirty = true));
    label.append(box, el("span", "", PORTAL_LABEL[p.id] ?? p.id));
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
    const [out] = await chrome.scripting.executeScript({ target: { tabId: activeTabId }, func: captureSnapshot });
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
