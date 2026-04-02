import type { GrantDiscoveryScope } from './discoverySearchProvider';

export interface GrantDiscoverySourceEntry {
  id: string;
  title: string;
  scope: GrantDiscoveryScope;
  jurisdiction: string;
  sourceUrl: string;
  summary: string;
  content?: string;
  keywords?: string[];
  eligibleModificationCodes?: string[];
  requiresOwnerOccupied?: boolean;
  requiresConsentConfirmed?: boolean;
}

export const DISCOVERY_FALLBACK_SOURCE_CATALOG: GrantDiscoverySourceEntry[] = [
  {
    id: 'municipal-home-accessibility',
    title: 'Municipal Home Accessibility Improvement Program',
    scope: 'MUNICIPAL',
    jurisdiction: 'ON',
    sourceUrl: 'https://www.ontario.ca/page/accessibility',
    summary: 'Municipal matching grant for low-barrier home accessibility upgrades.',
    content:
      'Supports grab bars, widened doorways, handrails, and walk-in showers for accessible home modifications.',
    keywords: ['accessibility', 'mobility', 'home', 'modification', 'barrier-free'],
    eligibleModificationCodes: ['GRAB_BARS', 'WALK_IN_SHOWER', 'HANDRAILS', 'WIDENED_DOORWAY'],
    requiresOwnerOccupied: false,
    requiresConsentConfirmed: true,
  },
  {
    id: 'provincial-assistive-home',
    title: 'Provincial Assistive Home Modification Grant',
    scope: 'PROVINCIAL',
    jurisdiction: 'ON',
    sourceUrl: 'https://www.ontario.ca/page/home-and-community-care',
    summary: 'Provincial grant supporting seniors and caregivers with accessibility modifications.',
    content:
      'Covers grab bars, raised toilets, stair lifts, walk-in showers, and handrails for qualifying households.',
    keywords: ['seniors', 'caregiver', 'accessibility', 'modification'],
    eligibleModificationCodes: ['GRAB_BARS', 'RAISED_TOILET', 'WALK_IN_SHOWER', 'STAIR_LIFT', 'HANDRAILS'],
    requiresOwnerOccupied: false,
    requiresConsentConfirmed: true,
  },
  {
    id: 'national-disability-home',
    title: 'National Disability and Home Accessibility Benefit',
    scope: 'NATIONAL',
    jurisdiction: 'CA',
    sourceUrl: 'https://www.canada.ca/en/services/benefits/disability.html',
    summary: 'Federal support for medically necessary residential accessibility improvements.',
    content:
      'Supports accessibility improvements for eligible Canadians requiring residential modifications.',
    keywords: ['federal', 'disability', 'accessibility', 'residential'],
    eligibleModificationCodes: ['GRAB_BARS', 'RAISED_TOILET', 'WALK_IN_SHOWER', 'WIDENED_DOORWAY', 'STAIR_LIFT', 'HANDRAILS'],
    requiresOwnerOccupied: false,
    requiresConsentConfirmed: true,
  },
];
