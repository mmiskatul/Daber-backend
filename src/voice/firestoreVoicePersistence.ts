import { VoiceLearnerTurnDraft, VoiceTutorTurnDraft } from "./turnAssembler";

export async function persistVoiceTurns(_input: {
  uid: string;
  scenarioSessionId: string;
  learnerTurn: VoiceLearnerTurnDraft;
  tutorTurn: VoiceTutorTurnDraft;
}): Promise<void> {}

export async function persistPronunciationPatch(_input: {
  uid: string;
  scenarioSessionId: string;
  learnerTurnCreatedAt: string;
  pronunciation: unknown;
}): Promise<void> {}
