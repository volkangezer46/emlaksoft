"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminFieldDataError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Saha verisi" homeHref="/admin/site" homeLabel="Site yönetimine dön" />;
}
