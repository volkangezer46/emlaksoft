import { EXTENSION_INSTALL_PATH, EXTENSION_LEGAL_NOTE } from "@/lib/listing-control/worker/extension-copy";
import { CLASSIFICATION_LABEL, HEALTH_LABEL, PORTAL_LABEL, RUN_STATE_LABEL, reasonLabel } from "@/lib/listing-control/worker/extension-labels";
import { sanitizeSettings } from "@/lib/listing-control/worker/extension-settings";
import type { RunState } from "@/lib/listing-control/worker/extension-status-view";
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

$("disconnect").addEventListener("click", async () => {
  const s = await call({ kind: "setConnected", connected: false });
  if (s) render(s);
});

$("help").addEventListener("click", () => {
  void chrome.tabs.create({ url: `${__EMLAKSOFT_APP_ORIGIN__}${EXTENSION_INSTALL_PATH}` });
});

void refresh();
setInterval(() => void refresh(), 5_000);
