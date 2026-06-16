"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Bell,
  CheckCheck,
  FileText,
  AlertCircle,
  CheckCircle2,
  Clock,
} from "lucide-react";

export type NotificationKind =
  | "estimate_ready"
  | "documents_requested"
  | "grant_status"
  | "photo_processed"
  | "info"
  | "action_required";

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  href?: string;
  createdAt: string | Date;
  read?: boolean;
  urgent?: boolean;
}

export interface NotificationCenterProps {
  notifications: NotificationItem[];
  onMarkRead?: (id: string) => void;
  onMarkAllRead?: () => void;
}

const KIND_META: Record<
  NotificationKind,
  { icon: React.ElementType; color: string }
> = {
  estimate_ready: { icon: CheckCircle2, color: "text-green-600" },
  documents_requested: { icon: FileText, color: "text-amber-600" },
  grant_status: { icon: AlertCircle, color: "text-blue-600" },
  photo_processed: { icon: CheckCircle2, color: "text-indigo-600" },
  info: { icon: Bell, color: "text-gray-600" },
  action_required: { icon: AlertCircle, color: "text-red-600" },
};

function formatRelative(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const diffMs = Date.now() - d.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

export function NotificationCenter({
  notifications,
  onMarkRead,
  onMarkAllRead,
}: NotificationCenterProps) {
  const [local, setLocal] = useState<NotificationItem[]>(notifications);
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocal(notifications);
  }, [notifications]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [isOpen]);

  const unreadCount = local.filter((n) => !n.read).length;

  const markRead = (id: string) => {
    setLocal((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
    onMarkRead?.(id);
  };

  const markAllRead = () => {
    setLocal((prev) => prev.map((n) => ({ ...n, read: true })));
    onMarkAllRead?.();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={`Notifications${
          unreadCount > 0 ? `, ${unreadCount} unread` : ""
        }`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-semibold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg sm:w-96"
        >
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all read
              </button>
            )}
          </div>

          {local.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-gray-500">
              <Clock className="mx-auto mb-2 h-5 w-5 text-gray-400" />
              You&apos;re all caught up.
            </div>
          ) : (
            <ul className="max-h-96 divide-y divide-gray-100 overflow-y-auto">
              {local.map((n) => {
                const meta = KIND_META[n.kind];
                const Icon = meta.icon;
                const content = (
                  <div
                    className={`flex gap-3 px-4 py-3 transition-colors ${
                      n.read ? "bg-white" : "bg-blue-50/60"
                    } ${n.href ? "hover:bg-gray-50" : ""}`}
                  >
                    <div className={`mt-0.5 shrink-0 ${meta.color}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p
                          className={`text-sm ${
                            n.read
                              ? "font-medium text-gray-700"
                              : "font-semibold text-gray-900"
                          }`}
                        >
                          {n.title}
                        </p>
                        {!n.read && (
                          <span
                            aria-hidden
                            className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-500"
                          />
                        )}
                      </div>
                      {n.body && (
                        <p className="mt-1 text-xs text-gray-600">{n.body}</p>
                      )}
                      <p className="mt-1 text-xs text-gray-400">
                        {formatRelative(n.createdAt)}
                      </p>
                    </div>
                  </div>
                );

                return (
                  <li key={n.id}>
                    {n.href ? (
                      <Link
                        href={n.href}
                        onClick={() => {
                          markRead(n.id);
                          setIsOpen(false);
                        }}
                        className="block"
                      >
                        {content}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => markRead(n.id)}
                        className="w-full text-left"
                      >
                        {content}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
