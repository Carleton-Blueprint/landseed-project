"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export const BACK_NAVIGATION = "__back__";

export function shouldInterceptNavigation(
  href: string | null,
  currentPath: string,
  origin: string
): boolean {
  if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
    return false;
  }
  if (href === currentPath) return false;

  try {
    const url = new URL(href, origin);
    if (url.origin !== origin) return false;
    return true;
  } catch {
    return false;
  }
}

type UseIntakeLeaveGuardOptions = {
  enabled: boolean;
  isSaving: boolean;
  saveNow: () => Promise<void>;
  flushBeaconSave: () => void;
};

export function useIntakeLeaveGuard({
  enabled,
  isSaving,
  saveNow,
  flushBeaconSave,
}: UseIntakeLeaveGuardOptions) {
  const router = useRouter();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [isLeaving, setIsLeaving] = useState(false);
  const allowNavigationRef = useRef(false);
  const popStatePushedRef = useRef(false);

  const openModal = useCallback((href: string) => {
    setPendingHref(href);
    setIsModalOpen(true);
  }, []);

  const handleStay = useCallback(() => {
    setIsModalOpen(false);
    setPendingHref(null);
  }, []);

  const handleSaveAndLeave = useCallback(async () => {
    setIsLeaving(true);
    try {
      await saveNow();
      allowNavigationRef.current = true;
      setIsModalOpen(false);

      if (pendingHref === BACK_NAVIGATION) {
        router.back();
      } else if (pendingHref) {
        router.push(pendingHref);
      }
      setPendingHref(null);
    } finally {
      setIsLeaving(false);
    }
  }, [pendingHref, router, saveNow]);

  useEffect(() => {
    if (!enabled) return;

    const onClick = (event: MouseEvent) => {
      if (allowNavigationRef.current || isModalOpen) return;

      const target = event.target;
      if (!(target instanceof Element)) return;

      const anchor = target.closest("a");
      if (!anchor) return;
      if (anchor.hasAttribute("download")) return;
      if (anchor.target === "_blank") return;

      const href = anchor.getAttribute("href");
      if (
        !shouldInterceptNavigation(
          href,
          window.location.pathname,
          window.location.origin
        )
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      openModal(href!);
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [enabled, isModalOpen, openModal]);

  useEffect(() => {
    if (!enabled) {
      popStatePushedRef.current = false;
      return;
    }

    if (!popStatePushedRef.current) {
      history.pushState(null, "", window.location.href);
      popStatePushedRef.current = true;
    }

    const onPopState = () => {
      if (allowNavigationRef.current) return;
      history.pushState(null, "", window.location.href);
      openModal(BACK_NAVIGATION);
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [enabled, openModal]);

  useEffect(() => {
    if (!enabled) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      flushBeaconSave();
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [enabled, flushBeaconSave]);

  useEffect(() => {
    if (!enabled) return;

    const onPageHide = () => {
      flushBeaconSave();
    };

    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [enabled, flushBeaconSave]);

  return {
    isModalOpen,
    isLeaving: isLeaving || isSaving,
    handleStay,
    handleSaveAndLeave,
  };
}
