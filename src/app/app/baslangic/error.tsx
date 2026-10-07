"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function BaslangicError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Kurulum" />;
}
