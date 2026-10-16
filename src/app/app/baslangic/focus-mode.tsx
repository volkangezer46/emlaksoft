/**
 * Kurulum ODAK MODU (C27): sihirbaz açıkken uygulama kabuğunun gezinmesi gizlenir (yan menü, üst çubuk, mobil alt çubuk);
 * kullanıcı yalnız adıma bakar ve tek çıkış "Kurulumdan çık"tır. Kabuk (layout) değişmez: kural yalnız işaretçi DOM'da
 * dururken geçerlidir (`.app-frame:has(...)`), sayfadan çıkınca işaretçiyle birlikte kalkar. Sunucuda çizilir (JS yok,
 * ilk boyamada menü görünmez).
 */
export const SETUP_FOCUS_ATTR = "data-setup-focus";

export const SETUP_FOCUS_CSS =
  `.app-frame:has([${SETUP_FOCUS_ATTR}]) :is(aside.shell-aside,header.glass-bar,nav[aria-label="Mobil hızlı gezinme"]){display:none!important}` +
  `.app-frame:has([${SETUP_FOCUS_ATTR}]) #main-content{padding-bottom:2rem}`;

export function SetupFocusMode() {
  return (
    <>
      <style>{SETUP_FOCUS_CSS}</style>
      <span {...{ [SETUP_FOCUS_ATTR]: "" }} hidden />
    </>
  );
}
