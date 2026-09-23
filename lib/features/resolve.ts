export type FeatureResolutionInput = {
  overrideEnabled: boolean | null;
  planEnabled: boolean | null;
};

/**
 * Explicit tenant override, then the plan feature, otherwise disabled.
 * `overrideEnabled === null` means there is no override row.
 */
export function resolveFeatureEnabled(input: FeatureResolutionInput) {
  if (input.overrideEnabled !== null) {
    return input.overrideEnabled;
  }

  return input.planEnabled === true;
}
