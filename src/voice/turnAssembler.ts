import { PronunciationResult } from "./types";

export type VoiceLearnerTurnDraft = {
  role: "learner";
  text: string;
  createdAt: string;
  inputMode: "voice";
  pronunciation?: PronunciationResult;
};

export type VoiceTutorTurnDraft = {
  role: "tutor";
  text: string;
  createdAt: string;
  translation: null;
  provider: "openai";
  model: string;
  liveModelCall: true;
};

export function buildLearnerVoiceTurn(transcript: string): VoiceLearnerTurnDraft {
  return {
    role: "learner",
    text: transcript,
    createdAt: new Date().toISOString(),
    inputMode: "voice"
  };
}

export function buildTutorVoiceTurn(text: string, model: string): VoiceTutorTurnDraft {
  return {
    role: "tutor",
    text,
    createdAt: new Date().toISOString(),
    translation: null,
    provider: "openai",
    model,
    liveModelCall: true
  };
}
