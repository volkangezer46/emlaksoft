"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminFunnelError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Huni ve kanallar" homeHref="/admin/site" homeLabel="Site yönetimine dön" />;
}
