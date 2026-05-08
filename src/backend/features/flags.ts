export enum FeatureFlag {
  MANUAL_REVIEW_AUTO_FLAG = 'MANUAL_REVIEW_AUTO_FLAG',
}

// Reads from FEATURE_FLAG_<FLAG_NAME> env vars, defaults to false
export function isFeatureFlagEnabled(flag: FeatureFlag): boolean {
  const envVar = `FEATURE_FLAG_${flag}`;
  const value = process.env[envVar];

  if (value === 'true') {
    return true;
  }

  return false;
}

export function getAllFeatureFlags(): Record<FeatureFlag, boolean> {
  const flags = Object.values(FeatureFlag) as FeatureFlag[];
  return Object.fromEntries(
    flags.map((flag) => [flag, isFeatureFlagEnabled(flag)])
  ) as Record<FeatureFlag, boolean>;
}

export function logFeatureFlags(): void {
  const flags = getAllFeatureFlags();
  console.log('[FeatureFlags] Current state:', flags);
}
