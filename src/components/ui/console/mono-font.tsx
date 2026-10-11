import { Geist_Mono } from "next/font/google";

// Geist Mono yalnız konsolda (/app, /admin) gerekir; public sayfalarda ek CSS isteği oluşmasın diye
// kök layout yerine konsol layout'larında yüklenir. Değişken yoksa tokens.css'teki yedek ui-monospace'e düşer.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
  preload: false,
  fallback: ["monospace"],
});

export function ConsoleMonoFont({ children }: { children: React.ReactNode }) {
  return (
    <div className={geistMono.variable} style={{ display: "contents" }}>
      {children}
    </div>
  );
}
