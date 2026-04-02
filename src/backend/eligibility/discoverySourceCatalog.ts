import { GrantDiscoveryScope } from './discoverySearchProvider';

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
    ],
    eligibleModificationCodes: [
      'GRAB_BAR', 'RAMP', 'WHEELCHAIR_RAMP', 'STAIR_LIFT', 'WALK_IN_TUB',
      'WIDER_DOORWAY', 'ROLL_IN_SHOWER', 'HANDRAIL', 'NON_SLIP_FLOORING',
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
    eligibleModificationCodes: ['SECONDARY_SUITE', 'ACCESSIBLE_SUITE'],
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
    sourceUrl: 'https://www.cmhc-schl.gc.ca/professionals/project-funding-and-mortgage-financing/funding-programs/all-funding-programs/residential-rehabilitation-assistance-program',
    summary:
      'Ontario provincial funding under Investment in Affordable Housing (IAH) for home repair and accessibility modifications for low-income homeowners and renters, including seniors and persons with disabilities.',
    keywords: [
      'RRAP', 'rehabilitation', 'affordable housing', 'accessibility', 'low income',
      'senior', 'disability', 'Ontario', 'IAH', 'renovation',
    ],
    eligibleModificationCodes: [
      'GRAB_BAR', 'RAMP', 'WHEELCHAIR_RAMP', 'STAIR_LIFT', 'WALK_IN_TUB',
      'WIDER_DOORWAY', 'ROLL_IN_SHOWER', 'HANDRAIL',
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
    eligibleModificationCodes: ['MOBILITY_DEVICE'],
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
    sourceUrl: 'https://www.toronto.ca/community-people/housing-shelter/housing-support/',
    summary:
      'City of Toronto forgivable loan and grant program to help eligible low- and moderate-income seniors and persons with disabilities make accessibility modifications to their homes.',
    keywords: [
      'Toronto', 'home improvement', 'senior', 'disability', 'accessibility',
      'forgivable loan', 'grant', 'municipal', 'ramp', 'lift',
    ],
    eligibleModificationCodes: [
      'GRAB_BAR', 'RAMP', 'WHEELCHAIR_RAMP', 'STAIR_LIFT', 'WALK_IN_TUB',
      'WIDER_DOORWAY', 'ROLL_IN_SHOWER', 'HANDRAIL', 'NON_SLIP_FLOORING',
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
  //     'GRAB_BAR', 'RAMP', 'WHEELCHAIR_RAMP', 'STAIR_LIFT', 'WALK_IN_TUB',
  //     'WIDER_DOORWAY', 'ROLL_IN_SHOWER', 'HANDRAIL', 'NON_SLIP_FLOORING',
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
  //     'GRAB_BAR', 'HANDRAIL', 'NON_SLIP_FLOORING', 'RAMP', 'WHEELCHAIR_RAMP', 'STAIR_LIFT',
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
  //     'GRAB_BAR', 'RAMP', 'WHEELCHAIR_RAMP', 'STAIR_LIFT', 'HANDRAIL', 'WIDER_DOORWAY',
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
  //     'GRAB_BAR', 'RAMP', 'WHEELCHAIR_RAMP', 'STAIR_LIFT', 'WALK_IN_TUB',
  //     'WIDER_DOORWAY', 'ROLL_IN_SHOWER', 'HANDRAIL',
  //   ],
  //   requiresOwnerOccupied: false,
  //   requiresConsentConfirmed: true,
  // },
];