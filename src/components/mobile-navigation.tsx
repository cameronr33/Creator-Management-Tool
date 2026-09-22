"use client";

import type { ReactNode } from "react";

export function MobileNavigation({ children }: { children: ReactNode }) {
  return <details className="mt-3 text-sidebar-text" onClick={event => {
    if ((event.target as HTMLElement).closest("a")) event.currentTarget.open = false;
  }}>
    <summary className="cursor-pointer rounded-md px-2 py-2 text-sm font-medium">Workspace menu</summary>
    <div className="py-3">{children}</div>
  </details>;
}
