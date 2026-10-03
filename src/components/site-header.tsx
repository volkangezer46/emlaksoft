"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Menu, X } from "lucide-react";

const LINKS = [
  { label: "Ürün", id: "ozellikler" },
  { label: "Nasıl çalışır", id: "nasil" },
  { label: "Güvenlik", id: "guvenlik" },
  { label: "Fiyat", id: "fiyat" },
  { label: "SSS", id: "sss" },
] as const;

/** Sticky üst bar: başta saydam, kaydırınca buzlu cam + alt çizgi; aktif bölüm alt çizgiyle işaretlenir. */
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setCurrent(e.target.id);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    for (const l of LINKS) {
      const el = document.getElementById(l.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="mk-nav" data-scrolled={scrolled} data-open={open}>
      <header>
        <div className="mk-wrap mk-nav-row">
          <Link href="/" className="mk-logo" aria-label="EmlakSoft ana sayfa">
            <i aria-hidden="true">E</i>EmlakSoft
          </Link>
          <nav aria-label="Ana site navigasyonu" className="mk-nav-links">
            {LINKS.map((l) => (
              <a key={l.id} href={`/#${l.id}`} aria-current={current === l.id ? "true" : undefined}>{l.label}</a>
            ))}
          </nav>
          <div className="mk-nav-cta">
            <Link href="/giris" className="mk-login">Giriş</Link>
            <Link href="/kayit" className="mk-btn mk-btn-primary">
              14 gün ücretsiz dene <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <button
              type="button"
              className="mk-burger"
              aria-label={open ? "Menüyü kapat" : "Menüyü aç"}
              aria-expanded={open}
              aria-controls="mobile-site-navigation"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </header>
      {open ? (
        <nav id="mobile-site-navigation" aria-label="Mobil site navigasyonu" className="mk-sheet">
          {LINKS.map((l) => (
            <a key={l.id} href={`/#${l.id}`} className="mk-sheet-link" onClick={() => setOpen(false)}>{l.label}</a>
          ))}
          <a href="/giris" className="mk-sheet-link" onClick={() => setOpen(false)}>Giriş</a>
          <div className="mk-sheet-cta">
            <Link href="/kayit" className="mk-btn mk-btn-primary" onClick={() => setOpen(false)}>14 gün ücretsiz dene</Link>
          </div>
        </nav>
      ) : null}
    </div>
  );
}
