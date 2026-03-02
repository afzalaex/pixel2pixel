// Internal-only pattern configuration for v9.
// Do not expose this in the main UI; tuning stays code-driven.
export const ACTIVE_PATTERN_CONFIG = Object.freeze({
  key: "rings",
  rotation: 0,
  mirrorX: false,
  mirrorY: false,
  phase: 0
});

export function patternConfigForRound(_roundId) {
  return ACTIVE_PATTERN_CONFIG;
}
