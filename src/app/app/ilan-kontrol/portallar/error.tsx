"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function PortallarError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Portallar" />;
}
