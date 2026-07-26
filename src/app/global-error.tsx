"use client";

import { useEffect, useRef } from "react";
import { reportClientError } from "@/app/actions/report-error";

/**
 * Kök layout çöktüğünde devreye girer — root layout'un YERİNE render edilir.
 * Bu yüzden html/body burada tanımlı ve globals.css'e güvenilmez: tüm kritik
 * stiller inline. Marka paleti: Ink #071a38 · Brand #1463ff · Mint #10b9a3.
 */

const ink = "#071a38";
const brand = "#1463ff";
const mint = "#10b9a3";
const muted = "#667085";
const line = "#e6eaf2";
const fontStack =
  "Manrope, 'Segoe UI', system-ui, -apple-system, sans-serif";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    console.error("Global error:", error);
    // Vercel loguna ek olarak DB'ye de yaz: log satirlari toplanmiyor ve
    // aranamiyordu. Ayni hata tekrar gelirse yeni satir degil sayac artiyor.
    void reportClientError({
      message: error.message || "Bilinmeyen hata",
      digest: error.digest,
      stack: error.stack,
      path: typeof window !== "undefined" ? window.location.pathname : undefined,
    });
  }, [error]);

  // Erişilebilirlik: odağı başlığa taşı — ekran okuyucular hatayı duyurur.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <html lang="tr">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f6f8fc",
          color: ink,
          fontFamily: fontStack,
          padding: 16,
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <title>Beklenmeyen hata — EmlakSoft</title>

        <main
          style={{
            width: "100%",
            maxWidth: 440,
            background: "#ffffff",
            border: `1px solid ${line}`,
            borderRadius: 20,
            overflow: "hidden",
            textAlign: "center",
            boxShadow:
              "0 1px 2px rgba(7,26,56,0.06), 0 24px 60px -24px rgba(7,26,56,0.25)",
          }}
        >
          {/* Marka şeridi: brand → mint */}
          <div
            style={{
              height: 4,
              background: `linear-gradient(100deg, ${brand}, ${mint})`,
            }}
          />

          <div style={{ padding: "40px 32px 36px" }}>
            <p
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 800,
                letterSpacing: "-0.01em",
                color: ink,
              }}
            >
              Emlak<span style={{ color: brand }}>Soft</span>
            </p>

            <div
              aria-hidden="true"
              style={{
                margin: "28px auto 0",
                width: 64,
                height: 64,
                borderRadius: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(229,72,77,0.1)",
                border: "1px solid rgba(229,72,77,0.15)",
                fontSize: 28,
                lineHeight: 1,
              }}
            >
              ⚠️
            </div>

            <h1
              ref={headingRef}
              tabIndex={-1}
              style={{
                margin: "20px 0 0",
                fontSize: 24,
                fontWeight: 800,
                letterSpacing: "-0.01em",
                outline: "none",
              }}
            >
              Beklenmeyen bir hata oluştu
            </h1>
            <p
              style={{
                margin: "10px auto 0",
                maxWidth: 340,
                fontSize: 14,
                lineHeight: 1.6,
                color: muted,
              }}
            >
              Uygulama şu anda yanıt veremiyor. Ekibimiz haberdar — hata otomatik
              olarak kayıt altına alındı. Tekrar denemek çoğu zaman sorunu çözer.
            </p>

            {error.digest ? (
              <p style={{ margin: "14px 0 0", fontSize: 12, color: muted }}>
                Hata kodu:{" "}
                <code
                  style={{
                    fontFamily: "ui-monospace, 'Cascadia Mono', monospace",
                    fontSize: 11,
                    background: "#f6f8fc",
                    border: `1px solid ${line}`,
                    borderRadius: 6,
                    padding: "2px 6px",
                    color: ink,
                  }}
                >
                  {error.digest}
                </code>
              </p>
            ) : null}

            <div
              style={{
                marginTop: 28,
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                justifyContent: "center",
              }}
            >
              <button
                type="button"
                onClick={() => unstable_retry()}
                style={{
                  padding: "12px 26px",
                  borderRadius: 11,
                  border: "none",
                  background: brand,
                  color: "#ffffff",
                  fontSize: 14,
                  fontWeight: 700,
                  fontFamily: fontStack,
                  cursor: "pointer",
                  boxShadow: "0 20px 50px -18px rgba(20,99,255,0.55)",
                }}
              >
                Tekrar dene
              </button>
              {/* Kök layout çökmüş olabilir — router olmadan tam sayfa dönüş bilinçli */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/"
                style={{
                  padding: "12px 26px",
                  borderRadius: 11,
                  border: "1px solid #d6ddec",
                  background: "#ffffff",
                  color: ink,
                  fontSize: 14,
                  fontWeight: 700,
                  textDecoration: "none",
                }}
              >
                Ana sayfa
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
