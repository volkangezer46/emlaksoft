"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function HedeflerError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Hedefler" />;
}
