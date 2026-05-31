import dotenv from "dotenv";

dotenv.config();

type EnvConfig = {
  port: number;
  firebaseProjectId: string;
  firebaseClientEmail: string;
  firebasePrivateKey: string;
  scenarioProviderDefault: "gemini" | "openai";
  openAiApiKey: string;
  openAiModel: string;
  openAiTranscriptionModel: string;
  openAiTtsModel: string;
  openAiTtsVoice: string;
  geminiApiKey: string;
  geminiModel: string;
  geminiAudioModel: string;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
};

function getEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getOptionalEnv(name: string, fallback = ""): string {
  return process.env[name] || fallback;
}

function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/g, "\n");
}

export const config: EnvConfig = {
  port: Number(process.env.PORT || 4000),
  firebaseProjectId: getEnv("FIREBASE_PROJECT_ID"),
  firebaseClientEmail: getEnv("FIREBASE_CLIENT_EMAIL"),
  firebasePrivateKey: normalizePrivateKey(getEnv("FIREBASE_PRIVATE_KEY")),
  scenarioProviderDefault: process.env.SCENARIO_PROVIDER_DEFAULT === "gemini" ? "gemini" : "openai",
  openAiApiKey: getOptionalEnv("OPENAI_API_KEY"),
  openAiModel: getOptionalEnv("OPENAI_SCENARIO_MODEL", "gpt-4.1-mini"),
  openAiTranscriptionModel: getOptionalEnv("OPENAI_TRANSCRIPTION_MODEL", "gpt-4o-mini-transcribe"),
  openAiTtsModel: getOptionalEnv("OPENAI_TTS_MODEL", "gpt-4o-mini-tts"),
  openAiTtsVoice: getOptionalEnv("OPENAI_TTS_VOICE", "coral"),
  geminiApiKey: getOptionalEnv("GEMINI_API_KEY"),
  geminiModel: getOptionalEnv("GEMINI_SCENARIO_MODEL", "gemini-2.0-flash"),
  geminiAudioModel: getOptionalEnv("GEMINI_AUDIO_MODEL", "gemini-2.5-flash"),
  jwtAccessSecret: getOptionalEnv("JWT_ACCESS_SECRET", "daber-access-secret-12345"),
  jwtRefreshSecret: getOptionalEnv("JWT_REFRESH_SECRET", "daber-refresh-secret-12345")
};
