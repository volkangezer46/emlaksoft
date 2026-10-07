"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function TaleplerError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Talepler" />;
}
