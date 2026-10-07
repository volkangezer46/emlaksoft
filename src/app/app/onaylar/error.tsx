"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function OnaylarError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Onaylar" />;
}
