export const DISCOVERY_SCORING_CONFIG = {
  nationalScopePoints: 25,
  jurisdictionMatchPoints: 30,
  jurisdictionMismatchPoints: 5,
  ownerOccupiedMatchPoints: 15,
  ownershipCompatiblePoints: 8,
  consentMatchPoints: 10,
  modificationOverlapMaxPoints: 35,
  missingFieldPenaltyPerField: 8,
  missingFieldPenaltyMax: 24,
  eligibleThreshold: 75,
  needsMoreInfoThreshold: 45,
} as const;