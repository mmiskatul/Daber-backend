import { VoiceSessionHotState } from "./types";

export interface VoiceSessionStore {
  get(voiceSessionId: string): Promise<VoiceSessionHotState | null>;
  set(session: VoiceSessionHotState): Promise<void>;
  delete(voiceSessionId: string): Promise<void>;
}

export class InMemoryVoiceSessionStore implements VoiceSessionStore {
  private readonly sessions = new Map<string, VoiceSessionHotState>();

  async get(voiceSessionId: string): Promise<VoiceSessionHotState | null> {
    return this.sessions.get(voiceSessionId) || null;
  }

  async set(session: VoiceSessionHotState): Promise<void> {
    this.sessions.set(session.voiceSessionId, session);
  }

  async delete(voiceSessionId: string): Promise<void> {
    this.sessions.delete(voiceSessionId);
  }
}

export const voiceSessionStore: VoiceSessionStore = new InMemoryVoiceSessionStore();
