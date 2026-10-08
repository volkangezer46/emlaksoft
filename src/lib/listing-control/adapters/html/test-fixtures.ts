import type { FetchedPage } from "./parse-core";

/**
 * SENTETİK portal sayfası üreticisi (YALNIZ testler). Gerçek portal sayfası KOPYALANMADI; her portalın bilinen yol/ilan no
 * biçimi ve kural dosyasındaki kalıplara uyan TEMSİLİ örnekler üretilir. Amaç karar sırasını ve katmanları kilitlemektir:
 * gerçek sayfa yapısı doğrulanana kadar kuralların `verified:false` kalması bu yüzdendir.
 */

export type FixturePortal = "sahibinden" | "hepsiemlak" | "emlakjet";

export type Scenario =
  | "live_jsonld"
  | "live_meta"
  | "live_state_next"
  | "live_state_window"
  | "live_dom"
  | "live_usd"
  | "live_dom_phrase_in_script"
  | "live_dom_no_price"
  | "removed_text"
  | "removed_state"
  | "not_found_404"
  | "gone_410"
  | "captcha"
  | "captcha_status_200_large_live_like"
  | "login_redirect"
  | "rate_limited"
  | "forbidden"
  | "server_error"
  | "unknown_structure"
  | "id_mismatch"
  | "conflicting_signals"
  | "redirected_out";

type Profile = {
  host: string;
  url: string;
  id: string;
  title: string;
  priceText: string;
  priceNum: number;
  advisor: string;
  removedPhrase: string;
  loginUrl: string;
  /** Bu portalın DOM'u (kural dosyasındaki kalıplara uyar). */
  dom: (o: { id: string | null; price: boolean }) => string;
};

const PROFILES: Record<FixturePortal, Profile> = {
  sahibinden: {
    host: "www.sahibinden.com",
    url: "https://www.sahibinden.com/ilan/emlak-konut-satilik-kadikoy-moda-3-1-1234567890/detay",
    id: "1234567890",
    title: "Kadıköy Moda'da 3+1 120 m² Daire",
    priceText: "4.750.000 TL",
    priceNum: 4_750_000,
    advisor: "Örnek Gayrimenkul",
    removedPhrase: "Bu ilan yayından kaldırılmıştır.",
    loginUrl: "https://secure.sahibinden.com/giris?return_url=x",
    dom: ({ id, price }) =>
      `<h1 class="classified-title">Kadıköy Moda&#39;da 3+1 120 m² Daire</h1>` +
      (price ? `<div class="classified-price-wrapper"><span class="classified-price">4.750.000 TL</span></div>` : "") +
      (id ? `<ul class="classified-info"><li><strong>İlan No</strong> <span>${id}</span></li></ul>` : "") +
      `<div class="username-info"><span>Örnek Gayrimenkul</span></div>`,
  },
  hepsiemlak: {
    host: "www.hepsiemlak.com",
    url: "https://www.hepsiemlak.com/istanbul-kadikoy-satilik/daire/12345678-detay",
    id: "12345678",
    title: "Kadıköy 2+1 Satılık Daire",
    priceText: "2.900.000 TL",
    priceNum: 2_900_000,
    advisor: "Deneme Ofis",
    removedPhrase: "Bu ilan artık yayında değil",
    loginUrl: "https://www.hepsiemlak.com/giris",
    dom: ({ id, price }) =>
      `<h1>Kadıköy 2+1 Satılık Daire</h1>` +
      (price ? `<div class="price">2.900.000 TL</div>` : "") +
      (id ? `<span>İlan No: <b>${id}</b></span>` : "") +
      `<div class="firm-name"><a>Deneme Ofis</a></div>`,
  },
  emlakjet: {
    host: "www.emlakjet.com",
    url: "https://www.emlakjet.com/ilan/kadikoy-satilik-daire-87654321",
    id: "87654321",
    title: "Kadıköy Satılık 3+1 Daire",
    priceText: "5.100.000 TL",
    priceNum: 5_100_000,
    advisor: "Emlak Dünyası",
    removedPhrase: "Aradığınız ilan yayında değil",
    loginUrl: "https://www.emlakjet.com/uye-girisi",
    dom: ({ id, price }) =>
      `<h1>Kadıköy Satılık 3+1 Daire</h1>` +
      (price ? `<span class="price-value">5.100.000 TL</span>` : "") +
      (id ? `<div>İlan Numarası ${id}</div>` : "") +
      `<div class="owner-name">Emlak Dünyası</div>`,
  },
};

export const FIXTURE_PORTALS: readonly FixturePortal[] = ["sahibinden", "hepsiemlak", "emlakjet"];

export function fixtureProfile(portal: FixturePortal) {
  const p = PROFILES[portal];
  return { id: p.id, url: p.url, title: p.title, priceNum: p.priceNum, advisor: p.advisor, host: p.host };
}

const wrap = (head: string, body: string) => `<!doctype html><html lang="tr"><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;

const ldScript = (p: Profile, currency: string) =>
  `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "BreadcrumbList", name: "Ana sayfa" },
      {
        "@type": "Product",
        name: p.title,
        sku: p.id,
        offers: { "@type": "Offer", price: String(p.priceNum), priceCurrency: currency, seller: { "@type": "Organization", name: p.advisor } },
      },
    ],
  })}</script>`;

const listingState = (p: Profile, status: string) => ({
  props: {
    pageProps: {
      listing: { listingId: p.id, title: p.title, price: { value: p.priceNum, currency: "TRY" }, storeName: p.advisor, status },
      similar: [{ listingId: "999999999", title: "Benzer ilan", price: { value: 1, currency: "TRY" } }],
    },
  },
});

/** Bir portal + senaryo için `{ page, expectedId }`. */
export function buildFixture(portal: FixturePortal, scenario: Scenario): { page: FetchedPage; expectedId: string } {
  const p = PROFILES[portal];
  const ok = (html: string, over: Partial<FetchedPage> = {}): FetchedPage => ({ status: 200, finalUrl: p.url, html, ...over });
  const empty = wrap("", "<p>Hoş geldiniz</p>");
  let page: FetchedPage;
  switch (scenario) {
    case "live_jsonld":
      page = ok(wrap(ldScript(p, "TRY"), "<p>içerik</p>"));
      break;
    case "live_meta":
      page = ok(
        wrap(
          `<meta property="og:title" content="${p.title} - ${portal}.com"><meta property="product:price:amount" content="${p.priceNum}"><meta property="product:price:currency" content="TRY"><link rel="canonical" href="${p.url}">`,
          "<p>içerik</p>",
        ),
      );
      break;
    case "live_state_next":
      page = ok(wrap(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(listingState(p, "ACTIVE"))}</script>`, "<p>içerik</p>"));
      break;
    case "live_state_window":
      page = ok(wrap(`<script>window.__INITIAL_STATE__ = ${JSON.stringify({ classified: listingState(p, "ACTIVE").props.pageProps.listing })};</script>`, "<p>içerik</p>"));
      break;
    case "live_dom":
      page = ok(wrap('<script src="https://www.google.com/recaptcha/api.js"></script>', p.dom({ id: p.id, price: true })));
      break;
    case "live_usd":
      page = ok(wrap(ldScript(p, "USD"), "<p>içerik</p>"));
      break;
    case "live_dom_phrase_in_script":
      page = ok(wrap(`<script>var i18n={"notFound":"${p.removedPhrase}"};</script>`, p.dom({ id: p.id, price: true })));
      break;
    case "live_dom_no_price":
      page = ok(wrap("", p.dom({ id: p.id, price: false })));
      break;
    case "removed_text":
      page = ok(wrap("", `<div class="warning">${p.removedPhrase}</div>${p.dom({ id: p.id, price: false })}`));
      break;
    case "removed_state":
      page = ok(wrap(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(listingState(p, "PASSIVE"))}</script>`, "<p>içerik</p>"));
      break;
    case "not_found_404":
      page = ok("", { status: 404 });
      break;
    case "gone_410":
      page = ok("", { status: 410 });
      break;
    case "captcha":
      page = ok(wrap('<script src="https://www.google.com/recaptcha/api.js"></script>', '<div class="g-recaptcha" data-sitekey="x"></div><p>Robot olmadığınızı doğrulayın</p>'));
      break;
    case "captcha_status_200_large_live_like":
      // Büyük, canlı görünümlü ama ilanı tanıtmayan sayfa + betikte "captcha" kelimesi: engel DEĞİL, "tanınmadı" (30 dk durdurmaz).
      page = ok(wrap(`<script>${"var captcha=1;".repeat(4000)}</script>`, "<p>Menü</p>".repeat(200)));
      break;
    case "login_redirect":
      page = ok("<html><body>Giriş yap</body></html>", { finalUrl: p.loginUrl });
      break;
    case "rate_limited":
      page = ok("", { status: 429 });
      break;
    case "forbidden":
      page = ok("", { status: 403 });
      break;
    case "server_error":
      page = ok("", { status: 503 });
      break;
    case "unknown_structure":
      page = ok(empty);
      break;
    case "id_mismatch":
      page = ok(wrap(ldScript({ ...p, id: "999999999" }, "TRY"), "<p>içerik</p>"));
      break;
    case "conflicting_signals":
      page = ok(wrap(ldScript(p, "TRY"), `<div>${p.removedPhrase}</div>`));
      break;
    case "redirected_out":
      page = ok(p.dom({ id: p.id, price: true }), { finalUrl: "https://evil.example/ilan" });
      break;
  }
  return { page, expectedId: p.id };
}
