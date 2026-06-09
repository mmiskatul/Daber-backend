import { VoiceRealtimeEvent, VoiceSessionHotState } from "./types";

export class OpenAiRealtimeClient {
  constructor(private readonly session: VoiceSessionHotState) {}

  async connect(): Promise<void> {
    void this.session;
  }

  async disconnect(): Promise<void> {}

  async appendAudioChunk(_pcm24kBase64: string): Promise<void> {}

  async commitInputAudio(): Promise<void> {}

  async createResponse(): Promise<void> {}

  async cancelResponse(): Promise<void> {}

  onEvent(_handler: (event: VoiceRealtimeEvent) => void): void {}
}
