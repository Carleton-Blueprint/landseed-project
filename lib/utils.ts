/**
 * Shared CSS class-name utility used across the app (e.g. shadcn/ui components).
 * Merges Tailwind classes with clsx + tailwind-merge so conditional and conflicting classes behave correctly.
 */
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
