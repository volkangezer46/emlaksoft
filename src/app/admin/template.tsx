/**
 * Admin sayfa geçişi — /app ile AYNI sistem (tek kaynak, bkz. src/app/app/template.tsx): yalnız CSS
 * (motion.css `.motion-page`, --motion-nav 150 ms, opacity). View Transitions kaldırıldı (zorunlu düzen maliyeti).
 */
export default function AdminTemplate({ children }: { children: React.ReactNode }) {
  return <div className="motion-page">{children}</div>;
}
