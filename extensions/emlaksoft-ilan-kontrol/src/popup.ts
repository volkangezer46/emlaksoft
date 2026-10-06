import { EXTENSION_INSTALL_PATH, EXTENSION_LEGAL_NOTE } from "@/lib/listing-control/worker/extension-copy";
import type { StatusReply } from "./messages";

/** Açılır pencere: durum, bugünkü kontrol sayısı, son kontrol, duraklat/sürdür, kurulum sayfası, yasal not. */

declare const __EMLAKSOFT_APP_ORIGIN__: string;

const $ = (id: string) => document.getElementById(id) as HTMLElement;

const OUTCOME: Record<string, string> = {
  found: "ilan yayında",
  not_found: "ilan bulunamadı",
  blocked: "portal engeli (kontrol edilemedi)",
  error: "kontrol edilemedi",
};

function timeLabel(ms: number | null): string {
  if (!ms) return "-";
  const d = new Date(ms);
  return d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

function render(s: StatusReply) {
  $("version").textContent = `Sürüm ${s.version} · kurallar ${s.rulesVersion}`;
  $("today").textContent = String(s.today);
  $("last").textContent = s.lastAt ? `${timeLabel(s.lastAt)} · ${OUTCOME[s.lastOutcome ?? "error"] ?? "-"}` : "-";
  const state = $("state");
  const now = Date.now();
  if (s.paused) {
    state.textContent = "Duraklatıldı: hiçbir ilan kontrol edilmiyor.";
    state.className = "state warn";
  } else if (s.cooldownUntil > now) {
    state.textContent = `Portal doğrulama/hız sınırı gösterdi; ${Math.ceil((s.cooldownUntil - now) / 60_000)} dk bekleniyor (aşılmaz).`;
    state.className = "state warn";
  } else if (s.leaderActive) {
    state.textContent = "Çalışıyor: EmlakSoft açık, ilanlar sırayla kontrol ediliyor.";
    state.className = "state ok";
  } else {
    state.textContent = "Beklemede: EmlakSoft sekmesi açık değil ya da oturum kapalı.";
    state.className = "state";
  }
  $("toggle").textContent = s.paused ? "Sürdür" : "Duraklat";
  $("toggle").dataset.paused = s.paused ? "1" : "0";
}

async function refresh() {
  const s = await chrome.runtime.sendMessage<StatusReply>({ kind: "status" }).catch(() => null);
  if (s) render(s);
}

$("legal").textContent = EXTENSION_LEGAL_NOTE;
$("toggle").addEventListener("click", async () => {
  const paused = $("toggle").dataset.paused !== "1";
  const s = await chrome.runtime.sendMessage<StatusReply>({ kind: "setPaused", paused }).catch(() => null);
  if (s) render(s);
});
$("help").addEventListener("click", () => {
  void chrome.tabs.create({ url: `${__EMLAKSOFT_APP_ORIGIN__}${EXTENSION_INSTALL_PATH}` });
});
void refresh();
setInterval(() => void refresh(), 5_000);
