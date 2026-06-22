"use client";

import React, { createContext, useContext } from "react";
import {
  useIntakeDraftAutosave,
  type IntakeDraftAutosave,
} from "@/frontend/hooks/useIntakeDraftAutosave";

const IntakeDraftContext = createContext<IntakeDraftAutosave | null>(null);

export function IntakeDraftProvider({ children }: { children: React.ReactNode }) {
  const value = useIntakeDraftAutosave();
  return (
    <IntakeDraftContext.Provider value={value}>{children}</IntakeDraftContext.Provider>
  );
}

export function useIntakeDraft() {
  const context = useContext(IntakeDraftContext);
  if (!context) {
    throw new Error("useIntakeDraft must be used within IntakeDraftProvider");
  }
  return context;
}
