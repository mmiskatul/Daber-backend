export type VoiceLatencyCheckpoint =
  | "session_created"
  | "speech_started"
  | "speech_stopped"
  | "openai_response_started"
  | "pronunciation_completed";

export function trackVoiceCheckpoint(_voiceSessionId: string, _checkpoint: VoiceLatencyCheckpoint): void {}
