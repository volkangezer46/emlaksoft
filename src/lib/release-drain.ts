import { existsSync } from "node:fs";

/**
 * SK1/B043 boşaltma: deploy.sh yayından çıkacak rengin konteynerinde bu dosyayı oluşturur. /api/health ve
 * /api/health/lb 503 döner, Traefik (loadbalancer.healthcheck, 2 sn) sunucuyu havuzdan çıkarır; açık istekler biter,
 * sonra konteyner durdurulur. Dosya konteynerin kendi /tmp'sindedir: yeni konteyner boşaltılmış başlamaz.
 */
export const DRAIN_FILE = "/tmp/emlaksoft-drain";

export function isDraining(): boolean {
  try {
    return existsSync(DRAIN_FILE);
  } catch {
    return false;
  }
}
