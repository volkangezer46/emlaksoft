/**
 * LazyMotion özellik paketi — AYRI parça olarak tembel yüklenir (ilk yük JS'ine girmez).
 * Yalnız `domAnimation` (animate/exit/whileInView/variants); `domMax` (layout/layoutId/drag,
 * ~+25 KB) bilinçli olarak YOK. Kural: docs/DESIGN_SYSTEM.md "Hareket katmanı".
 */
import { domAnimation } from "motion/react";

export default domAnimation;
