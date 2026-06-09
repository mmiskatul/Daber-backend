import { randomUUID } from "crypto";
import { config } from "../config";
import { CreateVoiceRtcSessionInput, IceServerConfig, VoiceRtcSessionResponse, VoiceSessionHotState } from "./types";
import { voiceSessionStore } from "./sessionStore";

function buildIceServers(): IceServerConfig[] {
  if (!config.turnPublicUrl) {
    return [];
  }

  return [
    {
      urls: [config.turnPublicUrl]
    }
  ];
}

export async function allocateVoiceRtcSession(input: CreateVoiceRtcSessionInput): Promise<VoiceRtcSessionResponse> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.voiceSessionTtlSeconds * 1000);
  const voiceSessionId = randomUUID();
  const gatewayNodeId = "voice-gateway-scaffold";
  const gatewayUrl = config.voiceGatewayPublicBaseUrl || config.voiceGatewayInternalBaseUrl || "";
  const tutorVoice = "Dana";

  const state: VoiceSessionHotState = {
    voiceSessionId,
    uid: input.uid,
    scenarioSessionId: input.scenarioSessionId,
    gatewayNodeId,
    transport: "webrtc",
    referenceText: input.referenceText,
    tutorVoice,
    state: "connecting",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString()
  };

  await voiceSessionStore.set(state);

  return {
    voiceSessionId,
    gatewayUrl,
    gatewayNodeId,
    answerSdp: [
      "v=0",
      "o=- 0 0 IN IP4 127.0.0.1",
      "s=Daber Voice RTC Scaffold",
      "t=0 0"
    ].join("\r\n"),
    iceServers: buildIceServers(),
    transport: "webrtc",
    scenarioSessionId: input.scenarioSessionId,
    tutorVoice,
    expiresAt: expiresAt.toISOString()
  };
}
