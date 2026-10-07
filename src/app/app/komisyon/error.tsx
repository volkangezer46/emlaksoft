"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function KomisyonError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Komisyon" />;
}
