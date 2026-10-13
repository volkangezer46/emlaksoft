/**
 * Site çerçevesi görsel sabitleri — tek kaynak. Paylaşım kartı (og-card.tsx, satori) ile yönetimdeki ölçekli önizlemesi
 * (admin/site-menu/frame-tabs.tsx) ve duyuru çubuğu önizlemesi aynı renkleri buradan okur; böylece önizleme canlıdan
 * sapmaz ve admin yüzeyinde ham renk birikmez (ui-ratchet). Saf modül: istemci bileşenlerinden de içe aktarılabilir.
 */
export const OG_THEME = {
  background: "linear-gradient(150deg, #0a2247 0%, #071a38 55%, #05122a 100%)",
  text: "#ffffff",
  glowBlue: "radial-gradient(circle, rgba(20,99,255,0.55), rgba(20,99,255,0) 70%)",
  glowGold: "radial-gradient(circle, rgba(246,210,122,0.22), rgba(246,210,122,0) 70%)",
  subtitle: "rgba(255,255,255,0.66)",
  chipBorder: "1px solid rgba(255,255,255,0.16)",
  chipBackground: "rgba(255,255,255,0.06)",
  chipText: "#f6d27a",
} as const;

/** Duyuru çubuğu zemini — marketing-sections.css `.mk-ann` ile aynı (değiştirirsen ikisini birlikte değiştir). */
export const ANNOUNCEMENT_BAR_BG = "linear-gradient(90deg, #0b1e4a, #1b3a8c)";
