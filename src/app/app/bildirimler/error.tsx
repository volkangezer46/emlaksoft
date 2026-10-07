"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function BildirimlerError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Bildirimler" />;
}
