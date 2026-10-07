"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function KampanyalarError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Kampanyalar" />;
}
