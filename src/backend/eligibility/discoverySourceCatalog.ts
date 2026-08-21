import { GrantDiscoveryScope } from './discoverySearchProvider';
import { MODIFICATION_CODES } from './types';

export interface GrantDiscoverySourceEntry {
  id: string;
  title: string;
  scope: GrantDiscoveryScope;
  jurisdiction: string;
  sourceUrl: string;
  summary: string;
  content?: string;
  keywords?: string[];
  /**
   * Must use values from MODIFICATION_CODES (types.ts) — this is compared
   * directly against a project's requested modification codes in
   * scoreCandidate() (discoverySearchProvider.ts). A value outside that enum
   * can never match and silently kills the modification-overlap scoring
   * signal for this entry (see docs/grant-discovery-verification-2026-08-14.md).
   * Leave as [] for programs that aren't modification-specific (e.g. fund
   * devices/equipment or a different purpose entirely) rather than inventing
   * codes the app doesn't track.
   */
  eligibleModificationCodes?: string[];
  requiresOwnerOccupied?: boolean; 
  requiresConsentConfirmed?: boolean;
}

/**
 * Fallback static catalog of known Canadian home accessibility grant programs.
 *
 * These entries are used for heuristic scoring when the AI web search path is
 * unavailable.  Keep URLs pointed at the canonical program page so that
 * fetchCatalogFromUrl can attempt to pull live content.
 *
 * Last reviewed: 2026-04
 */
export const DISCOVERY_FALLBACK_SOURCE_CATALOG: GrantDiscoverySourceEntry[] = [
  // ---------------------------------------------------------------------------
  // NATIONAL
  // ---------------------------------------------------------------------------
  {
    // Checked 2026-08-21 when adding RAMP/WHEELCHAIR_RAMP/WALK_IN_TUB/
    // NON_SLIP_FLOORING: canada.ca returns 403 to automated fetches, so the
    // live page itself couldn't be re-verified directly here. Corroborated
    // instead via web search against multiple third-party tax/accessibility
    // sources that cite CRA's own line-31285 examples (e.g. taxtool.ca:
    // "walk-in showers, grab bars, wheelchair ramps, stair lifts, doorway
    // widening, comfort-height toilets, lowered counters, non-slip flooring,
    // and lever-style door handles"), which explicitly names wheelchair
    // ramps, walk-in tubs, and non-slip flooring as qualifying expenses.
    id: 'hatc_canada',
    title: 'Home Accessibility Tax Credit (HATC)',
    scope: 'NATIONAL',
    jurisdiction: 'CA',
    sourceUrl:
      'https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/deductions-credits-expenses/line-31285-home-accessibility-expenses.html',
    summary:
      'Federal non-refundable tax credit on up to $20,000 of eligible home renovation expenses that improve accessibility or reduce the risk of harm for qualifying seniors or persons with disabilities. Worth up to $3,000 per year.',
    keywords: [
      'tax credit', 'accessibility', 'renovation', 'senior', 'disability',
      'grab bar', 'ramp', 'wheelchair', 'walk-in tub', 'stair lift', 'federal', 'CRA',
      'non-slip flooring',
    ],
    eligibleModificationCodes: [
      MODIFICATION_CODES.GRAB_BARS, MODIFICATION_CODES.RAISED_TOILET, MODIFICATION_CODES.WALK_IN_SHOWER,
      MODIFICATION_CODES.WIDENED_DOORWAY, MODIFICATION_CODES.STAIR_LIFT, MODIFICATION_CODES.HANDRAILS,
      MODIFICATION_CODES.RAMP, MODIFICATION_CODES.WHEELCHAIR_RAMP, MODIFICATION_CODES.WALK_IN_TUB,
      MODIFICATION_CODES.NON_SLIP_FLOORING,
    ],
    requiresOwnerOccupied: true,
    requiresConsentConfirmed: true,
  },
  {
    id: 'hbtc_canada',
    title: "Home Buyers' Tax Credit (HBTC) — Accessibility",
    scope: 'NATIONAL',
    jurisdiction: 'CA',
    sourceUrl:
      'https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/deductions-credits-expenses/line-31270-home-buyers-amount.html',
    summary:
      'Federal non-refundable tax credit of up to $1,500 for eligible home buyers, including persons with disabilities purchasing a home that is more accessible or better suited to their needs.',
    keywords: ['tax credit', 'home buyer', 'disability', 'accessible', 'federal', 'CRA'],
    eligibleModificationCodes: [],
    requiresOwnerOccupied: true,
    requiresConsentConfirmed: true,
  },
  {
    id: 'cmhc_secondary_suite',
    title: 'CMHC Secondary Suite Loan Program',
    scope: 'NATIONAL',
    jurisdiction: 'CA',
    // Updated: previous URL returned 404
    sourceUrl: 'https://www.cmhc-schl.gc.ca/en/consumers/home-buying',
    summary:
      'Low-interest loans of up to $40,000 to help homeowners add a secondary suite, including accessible or multigenerational units.',
    keywords: ['CMHC', 'secondary suite', 'loan', 'accessible', 'multigenerational', 'federal'],
    // Not a modification-code-based grant (funds adding a suite, not accessibility
    // renovations) — leave empty rather than inventing codes the app doesn't track.
    eligibleModificationCodes: [],
    requiresOwnerOccupied: true,
    requiresConsentConfirmed: true,
  },

  // ---------------------------------------------------------------------------
  // ONTARIO — PROVINCIAL
  // ---------------------------------------------------------------------------
  {
    id: 'on_rrap',
    title: 'Ontario — Residential Rehabilitation Assistance Program (RRAP) / IAH',
    scope: 'PROVINCIAL',
    jurisdiction: 'ON',
    // Updated: /investment-affordable-housing-program and /find-housing-help both 404
    // Checked 2026-08-21 when adding RAMP/WHEELCHAIR_RAMP/WALK_IN_TUB/
    // NON_SLIP_FLOORING: this page has no itemized modification list at all
    // (just "modifications to improve accessibility... or minor adaptations
    // for seniors" as a catch-all) — same as the pre-existing 6 codes here,
    // none of which are individually confirmed by this page either. Kept the
    // blanket-coverage treatment consistent with the original codes rather
    // than singling out the new ones as unverified.
    sourceUrl: 'https://www.cmhc-schl.gc.ca/professionals/project-funding-and-mortgage-financing/funding-programs/all-funding-programs/residential-rehabilitation-assistance-program',
    summary:
      'Ontario provincial funding under Investment in Affordable Housing (IAH) for home repair and accessibility modifications for low-income homeowners and renters, including seniors and persons with disabilities.',
    keywords: [
      'RRAP', 'rehabilitation', 'affordable housing', 'accessibility', 'low income',
      'senior', 'disability', 'Ontario', 'IAH', 'renovation',
    ],
    eligibleModificationCodes: [
      MODIFICATION_CODES.GRAB_BARS, MODIFICATION_CODES.RAISED_TOILET, MODIFICATION_CODES.WALK_IN_SHOWER,
      MODIFICATION_CODES.WIDENED_DOORWAY, MODIFICATION_CODES.STAIR_LIFT, MODIFICATION_CODES.HANDRAILS,
      MODIFICATION_CODES.RAMP, MODIFICATION_CODES.WHEELCHAIR_RAMP, MODIFICATION_CODES.WALK_IN_TUB,
      MODIFICATION_CODES.NON_SLIP_FLOORING,
    ],
    requiresOwnerOccupied: true,
    requiresConsentConfirmed: true,
  },
  {
    id: 'on_adp',
    title: 'Ontario Assistive Devices Program (ADP)',
    scope: 'PROVINCIAL',
    jurisdiction: 'ON',
    sourceUrl: 'https://www.ontario.ca/page/assistive-devices-program',
    summary:
      'Ontario program that funds assistive devices for people with long-term physical disabilities, including mobility aids. Complements accessibility renovations.',
    keywords: ['assistive devices', 'disability', 'Ontario', 'mobility', 'ADP'],
    // Not a modification-code-based grant (funds mobility devices/equipment,
    // not home renovations) — leave empty rather than inventing codes the
    // app doesn't track. See docs/grant-discovery-verification-2026-08-14.md
    // for a case where the AI incorrectly marked this ELIGIBLE for GRAB_BARS.
    eligibleModificationCodes: [],
    requiresOwnerOccupied: false,
    requiresConsentConfirmed: true,
  },
  {
    // Added 2026-08-14: surfaced consistently (6/6 runs, ELIGIBLE/HIGH confidence)
    // by the live grant discovery AI during ground-truth verification —
    // see docs/grant-discovery-verification-2026-08-14.md. Verified 2026-08-14
    // against the live ontario.ca page: funds home AND vehicle modifications
    // for Ontario residents with a permanent disability affecting mobility;
    // eligibility centers on disability + residency + income (over $35k/year
    // may require a cost contribution), not homeownership — no owner-occupied
    // requirement found on the live page.
    // Re-verified 2026-08-21 against the live page when adding RAMP/
    // WHEELCHAIR_RAMP/WALK_IN_TUB/NON_SLIP_FLOORING: page explicitly lists
    // "ramps" (kept RAMP and WHEELCHAIR_RAMP — the program's whole mandate is
    // mobility-disability access, and "ramps" isn't qualified to just one
    // size) and bathroom coverage of "wheel-in showers, wall grab bars, and
    // bathtub safety rails" — no walk-in tub, no non-slip/slip-resistant
    // flooring mentioned, so those two are deliberately left out.
    id: 'on_hvmp',
    title: 'Ontario Home and Vehicle Modification Program (HVMP)',
    scope: 'PROVINCIAL',
    jurisdiction: 'ON',
    sourceUrl: 'https://www.ontario.ca/page/home-and-vehicle-modification-program',
    summary:
      'Ontario program that helps cover the cost of home and vehicle modifications for permanent Ontario residents with a substantial, long-term disability affecting mobility, to improve accessibility and independence. Applicants must exhaust other funding sources first; those earning over $35,000/year may need to contribute to costs.',
    keywords: [
      'HVMP', 'home and vehicle modification', 'Ontario', 'disability', 'senior',
      'accessibility', 'grab bar', 'ramp', 'stair lift', 'doorway', 'bathroom',
    ],
    eligibleModificationCodes: [
      MODIFICATION_CODES.GRAB_BARS, MODIFICATION_CODES.RAISED_TOILET, MODIFICATION_CODES.WALK_IN_SHOWER,
      MODIFICATION_CODES.WIDENED_DOORWAY, MODIFICATION_CODES.STAIR_LIFT, MODIFICATION_CODES.HANDRAILS,
      MODIFICATION_CODES.RAMP, MODIFICATION_CODES.WHEELCHAIR_RAMP,
    ],
    requiresOwnerOccupied: false,
    requiresConsentConfirmed: true,
  },

  // ---------------------------------------------------------------------------
  // ONTARIO — MUNICIPAL
  // ---------------------------------------------------------------------------
  {
    id: 'toronto_hip',
    title: 'City of Toronto — Home Improvement Program for Seniors & Persons with Disabilities',
    scope: 'MUNICIPAL',
    jurisdiction: 'ON',
    // Updated: previous deep URL returned 404
    // Checked 2026-08-21 when adding RAMP/WHEELCHAIR_RAMP/WALK_IN_TUB/
    // NON_SLIP_FLOORING: this page (and the more specific homeowner-support
    // page it links to) has no itemized modification list — same as the
    // pre-existing 6 codes here, none of which are individually confirmed by
    // a live source either. Kept the blanket-coverage treatment consistent
    // with the original codes rather than singling out the new ones as
    // unverified.
    sourceUrl: 'https://www.toronto.ca/community-people/housing-shelter/housing-support/',
    summary:
      'City of Toronto forgivable loan and grant program to help eligible low- and moderate-income seniors and persons with disabilities make accessibility modifications to their homes.',
    keywords: [
      'Toronto', 'home improvement', 'senior', 'disability', 'accessibility',
      'forgivable loan', 'grant', 'municipal', 'ramp', 'lift',
    ],
    eligibleModificationCodes: [
      MODIFICATION_CODES.GRAB_BARS, MODIFICATION_CODES.RAISED_TOILET, MODIFICATION_CODES.WALK_IN_SHOWER,
      MODIFICATION_CODES.WIDENED_DOORWAY, MODIFICATION_CODES.STAIR_LIFT, MODIFICATION_CODES.HANDRAILS,
      MODIFICATION_CODES.RAMP, MODIFICATION_CODES.WHEELCHAIR_RAMP, MODIFICATION_CODES.WALK_IN_TUB,
      MODIFICATION_CODES.NON_SLIP_FLOORING,
    ],
    requiresOwnerOccupied: true,
    requiresConsentConfirmed: true,
  },
  {
    // Added 2026-08-18: surfaced repeatedly by the live grant discovery AI
    // during 2026-08-14/08-15 ground-truth verification (see
    // docs/grant-discovery-verification-2026-08-14.md and -2026-08-15.md) as
    // "Ontario Renovates Program (City of London)". Verified 2026-08-18
    // against the live london.ca page and the official 2025 Homeowner
    // Package/application form (Revised May 2025): individual seniors
    // (60+) or persons with disabilities apply directly to the City of
    // London (Middlesex County residents also eligible) — not an
    // organization-only program.
    id: 'london_ontario_renovates',
    title: 'Ontario Renovates Program (City of London)',
    scope: 'MUNICIPAL',
    jurisdiction: 'ON',
    sourceUrl: 'https://london.ca/living-london/building-renovating/ontario-renovates',
    summary:
      'City of London program (also serving Middlesex County) providing a one-time 10-year forgivable loan of up to $25,000 for eligible home repairs and/or accessibility modifications for low-to-moderate income seniors (60+) and persons with disabilities. The first $5,000 of an approved accessibility-modification request is a non-repayable grant. Household income must be at or below $95,000/year and liquid assets at or below $30,000; the property must be the applicant\'s sole and principal residence.',
    keywords: [
      'Ontario Renovates', 'London', 'Middlesex', 'forgivable loan', 'senior',
      'disability', 'accessibility', 'grab bar', 'ramp', 'stair lift', 'municipal',
    ],
    // Narrowed to what the program's own application form actually offers as
    // accessibility-modification checkboxes (Ramps, Handrails, Levered
    // handles, Fire alarms, Grab bars, Accessible shower stalls, Chair and
    // bath lifts, Raised toilets, Height adjustment to countertops) rather
    // than copying the standard 6-code set used elsewhere in this catalog.
    // WIDENED_DOORWAY is deliberately excluded: "doors and windows" only
    // appears under the separate general home-repair category on the form,
    // not the accessibility-modification checklist — an applicant has no
    // way to request doorway widening under this specific program. RAMP is
    // included (the form lists "Ramps"); WHEELCHAIR_RAMP, WALK_IN_TUB, and
    // NON_SLIP_FLOORING are excluded — not on the form's checkbox list.
    eligibleModificationCodes: [
      MODIFICATION_CODES.GRAB_BARS, MODIFICATION_CODES.RAISED_TOILET,
      MODIFICATION_CODES.WALK_IN_SHOWER, MODIFICATION_CODES.STAIR_LIFT,
      MODIFICATION_CODES.HANDRAILS, MODIFICATION_CODES.RAMP,
    ],
    requiresOwnerOccupied: true,
    requiresConsentConfirmed: true,
  },

  // ---------------------------------------------------------------------------
  // BRITISH COLUMBIA — PROVINCIAL
  // ---------------------------------------------------------------------------
  // {
  //   id: 'bc_hafi',
  //   title: 'BC Home Adaptations for Independence (HAFI)',
  //   scope: 'PROVINCIAL',
  //   jurisdiction: 'BC',
  //   // Updated: /housing-assistance/home-adaptations returned 404
  //   sourceUrl: 'https://www.bchousing.org/housing-assistance',
  //   summary:
  //     'BC Housing program assisting low-income seniors and persons with disabilities with the cost of home adaptations needed to remain safely and independently in their own homes.',
  //   keywords: [
  //     'HAFI', 'home adaptations', 'independence', 'British Columbia', 'BC Housing',
  //     'senior', 'disability', 'low income', 'accessibility',
  //   ],
  //   eligibleModificationCodes: [
  //     MODIFICATION_CODES.GRAB_BARS, MODIFICATION_CODES.RAISED_TOILET, MODIFICATION_CODES.WALK_IN_SHOWER,
  //     MODIFICATION_CODES.WIDENED_DOORWAY, MODIFICATION_CODES.STAIR_LIFT, MODIFICATION_CODES.HANDRAILS,
  //   ],
  //   requiresOwnerOccupied: true,
  //   requiresConsentConfirmed: true,
  // },
  // {
  //   id: 'bc_safer',
  //   title: 'BC SAFER (Safety Aspects of Falls in the Elderly Reno) Program',
  //   scope: 'PROVINCIAL',
  //   jurisdiction: 'BC',
  //   // Updated: same dead URL as bc_hafi — using parent path
  //   sourceUrl: 'https://www.bchousing.org/housing-assistance',
  //   summary:
  //     'BC Housing grant for low-income senior homeowners and those with disabilities for home adaptations that improve safety and reduce fall risk.',
  //   keywords: [
  //     'BC Housing', 'SAFER', 'British Columbia', 'senior', 'disability',
  //     'fall prevention', 'accessibility', 'adaptation', 'grant',
  //   ],
  //   eligibleModificationCodes: [
  //     MODIFICATION_CODES.GRAB_BARS, MODIFICATION_CODES.HANDRAILS, MODIFICATION_CODES.STAIR_LIFT,
  //   ],
  //   requiresOwnerOccupied: true,
  //   requiresConsentConfirmed: true,
  // },

  // ---------------------------------------------------------------------------
  // ALBERTA — PROVINCIAL
  // ---------------------------------------------------------------------------
  // {
  //   id: 'ab_sharp',
  //   title: 'Alberta Seniors Home Adaptation and Repair Program (SHARP)',
  //   scope: 'PROVINCIAL',
  //   jurisdiction: 'AB',
  //   sourceUrl: 'https://www.alberta.ca/seniors-home-adaptation-repair-program',
  //   summary:
  //     'Low-interest home equity loan for Alberta seniors for home adaptations and repairs, including accessibility modifications such as ramps, grab bars, and stair lifts.',
  //   keywords: [
  //     'SHARP', 'Alberta', 'senior', 'home adaptation', 'repair', 'loan',
  //     'accessibility', 'ramp', 'grab bar', 'stair lift',
  //   ],
  //   eligibleModificationCodes: [
  //     MODIFICATION_CODES.GRAB_BARS, MODIFICATION_CODES.STAIR_LIFT, MODIFICATION_CODES.HANDRAILS,
  //     MODIFICATION_CODES.WIDENED_DOORWAY,
  //   ],
  //   requiresOwnerOccupied: true,
  //   requiresConsentConfirmed: true,
  // },

  // ---------------------------------------------------------------------------
  // QUEBEC — PROVINCIAL
  // ---------------------------------------------------------------------------
  // {
  //   id: 'qc_pad',
  //   title: "Québec — Programme d'adaptation de domicile (PAD)",
  //   scope: 'PROVINCIAL',
  //   jurisdiction: 'QC',
  //   // Note: this host blocks Node.js fetch (firewall/user-agent). The static
  //   // entry will be used as-is via the graceful fallback in loadDiscoverySources.
  //   sourceUrl: 'https://www.habitationquebec.gouv.qc.ca/proprietaires/adaptation-domicile/',
  //   summary:
  //     'Québec provincial grant for persons with significant functional limitations to adapt their primary residence, covering ramps, grab bars, roll-in showers, and stair lifts.',
  //   keywords: [
  //     'PAD', 'Québec', 'adaptation', 'domicile', 'disability', 'functional limitation',
  //     'ramp', 'grab bar', 'roll-in shower', 'stair lift', 'accessibility',
  //   ],
  //   eligibleModificationCodes: [
  //     MODIFICATION_CODES.GRAB_BARS, MODIFICATION_CODES.RAISED_TOILET, MODIFICATION_CODES.WALK_IN_SHOWER,
  //     MODIFICATION_CODES.WIDENED_DOORWAY, MODIFICATION_CODES.STAIR_LIFT, MODIFICATION_CODES.HANDRAILS,
  //   ],
  //   requiresOwnerOccupied: false,
  //   requiresConsentConfirmed: true,
  // },
];