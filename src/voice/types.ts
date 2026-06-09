export type VoiceTransport = "upload" | "webrtc";

export type IceServerConfig = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

export type VoiceRtcSessionState =
  | "connecting"
  | "listening"
  | "processing"
  | "speaking"
  | "closed";

export type CreateVoiceRtcSessionInput = {
  uid: string;
  scenarioSessionId: string;
  offerSdp: string;
  referenceText?: string;
};

export type ReconnectVoiceRtcSessionInput = {
  voiceSessionId: string;
  offerSdp: string;
};

export type VoiceRtcSessionResponse = {
  voiceSessionId: string;
  gatewayUrl: string;
  gatewayNodeId: string;
  answerSdp: string;
  iceServers: IceServerConfig[];
  transport: "webrtc";
  scenarioSessionId: string;
  tutorVoice: string;
  expiresAt: string;
};

export type VoiceSessionHotState = {
  voiceSessionId: string;
  uid: string;
  scenarioSessionId: string;
  gatewayNodeId: string;
  transport: "webrtc";
  openAiSessionId?: string;
  learnerTurnLocalId?: string;
  tutorTurnLocalId?: string;
  referenceText?: string;
  tutorVoice: string;
  state: VoiceRtcSessionState;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

export type PronunciationJob = {
  voiceSessionId: string;
  utteranceId: string;
  uid: string;
  scenarioSessionId: string;
  pcm16Base64: string;
  sampleRateHz: 16000;
  channels: 1;
  language: "he";
  referenceText?: string;
  transcriptHint?: string;
  createdAt: string;
};

export type PronunciationResult = {
  voiceSessionId: string;
  utteranceId: string;
  learnerTurnLocalId: string;
  overallScore: number;
  accuracyScore: number;
  fluencyScore: number;
  feedback: string;
  scoringMode: "audio" | "transcript";
  issues: Array<{
    label: string;
    issueCount: number;
    severity: "low" | "medium" | "high";
    affectedWord: string;
    expectedSound: string;
    heardApproximation: string;
    hint: string;
  }>;
  completedAt: string;
};

export type VoiceRealtimeEvent =
  | { type: "voice.session.ready"; voiceSessionId: string }
  | { type: "voice.session.state"; state: VoiceRtcSessionState; voiceSessionId: string }
  | { type: "voice.input.speech_started"; utteranceId: string; startedAt: string }
  | { type: "voice.input.speech_stopped"; utteranceId: string; stoppedAt: string }
  | { type: "voice.learner.transcript.partial"; utteranceId: string; text: string }
  | { type: "voice.learner.transcript.final"; utteranceId: string; text: string }
  | { type: "voice.tutor.pending"; utteranceId: string; tutorName: string }
  | { type: "voice.tutor.text.partial"; utteranceId: string; textDelta: string }
  | { type: "voice.tutor.turn.final"; utteranceId: string; tutorText: string }
  | { type: "voice.pronunciation.pending"; utteranceId: string; learnerTurnLocalId: string }
  | { type: "voice.pronunciation.final"; result: PronunciationResult }
  | { type: "voice.output.audio.started"; utteranceId: string }
  | { type: "voice.output.audio.stopped"; utteranceId: string }
  | { type: "voice.error"; code: string; message: string; retryable: boolean };
