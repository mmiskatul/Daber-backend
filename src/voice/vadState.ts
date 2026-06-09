export type VadSessionState = {
  utteranceId: string | null;
  speaking: boolean;
  speechStartedAt: string | null;
};

export function createInitialVadState(): VadSessionState {
  return {
    utteranceId: null,
    speaking: false,
    speechStartedAt: null
  };
}
