import { config } from "./config";
import { AppError } from "./errors";

type SessionTurn = {
  role?: string;
  text?: string;
};

type ScenarioTutorContext = {
  provider: "gemini" | "openai";
  tutorName: string;
  tutorSubtitle?: string;
  themeTitle: string;
  themeId: string;
  situation: string;
  level?: string | null;
  goal?: string | null;
  native?: string | null;
  starterLine?: string;
  priorTurns?: SessionTurn[];
  learnerMessage: string;
};

type ScenarioProviderResult = {
  text: string;
  translation?: string | null;
  provider: "gemini" | "openai";
  model: string;
  liveModelCall: boolean;
};

type PronunciationAssessment = {
  overallScore: number;
  accuracyScore: number;
  fluencyScore: number;
  feedback: string;
  scoringMode: "audio" | "transcript";
};

type ScenarioVoiceContext = ScenarioTutorContext & {
  audioBase64: string;
  mimeType: string;
  fileName: string;
  referenceText?: string;
};

type ScenarioVoiceResult = {
  transcript: string;
  pronunciation: PronunciationAssessment;
  tutorReply: ScenarioProviderResult;
};

type ScenarioVoiceTranscriptResult = {
  transcript: string;
};

function buildPrompt(context: ScenarioTutorContext): string {
  const priorTurns = (context.priorTurns || [])
    .slice(-8)
    .map((turn) => `${turn.role === "learner" ? "Learner" : "Tutor"}: ${turn.text || ""}`)
    .join("\n");

  return [
    `You are ${context.tutorName}, a Hebrew tutor for Daber.`,
    `Tutor style: ${context.tutorSubtitle || "Warm, patient, direct."}`,
    `Scenario theme: ${context.themeTitle} (${context.themeId}).`,
    `Situation: ${context.situation}`,
    `Learner level: ${context.level || "unknown"}`,
    `Learner goal: ${context.goal || "unknown"}`,
    `Learner native language: ${context.native || "unknown"}`,
    "Reply in a short, natural tutor turn suitable for a live spoken roleplay.",
    "Keep the reply concise, supportive, and scenario-specific.",
    "Return JSON only with keys reply and translation.",
    "reply must be Hebrew only.",
    "translation must be a concise support translation in the learner native language only.",
    "If the learner native language is missing or set to Other, use English for translation.",
    "Do not include multiple support languages.",
    context.starterLine ? `Original starter line: ${context.starterLine}` : "",
    priorTurns ? `Conversation so far:\n${priorTurns}` : "",
    `Learner just said: ${context.learnerMessage}`
  ]
    .filter(Boolean)
    .join("\n\n");
}

function clampScore(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] || text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new AppError(502, "VOICE_JSON_PARSE_FAILED", "Provider response did not contain a valid JSON object.");
  }

  return candidate.slice(start, end + 1);
}

function normalizePronunciation(value: unknown, scoringMode: "audio" | "transcript"): PronunciationAssessment {
  const parsed = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    overallScore: clampScore(parsed.overallScore),
    accuracyScore: clampScore(parsed.accuracyScore),
    fluencyScore: clampScore(parsed.fluencyScore),
    feedback: typeof parsed.feedback === "string" && parsed.feedback.trim() ? parsed.feedback.trim() : "Keep the sentence shorter and stress the key word more clearly.",
    scoringMode
  };
}

function normalizeScenarioReply(
  rawText: string,
  provider: "gemini" | "openai",
  model: string
): ScenarioProviderResult {
  try {
    const parsed = JSON.parse(extractJsonObject(rawText)) as {
      reply?: unknown;
      translation?: unknown;
    };

    const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
    const translation = typeof parsed.translation === "string" ? parsed.translation.trim() : "";

    if (reply) {
      return {
        text: reply,
        translation: translation || null,
        provider,
        model,
        liveModelCall: true
      };
    }
  } catch {
    // Fall through to plain-text fallback.
  }

  return {
    text: rawText.trim(),
    translation: null,
    provider,
    model,
    liveModelCall: true
  };
}

async function callOpenAiText(prompt: string): Promise<string> {
  if (!config.openAiApiKey) {
    throw new AppError(500, "OPENAI_API_KEY_MISSING", "OPENAI_API_KEY is not configured.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openAiApiKey}`
    },
    body: JSON.stringify({
      model: config.openAiModel,
      input: prompt
    })
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        output_text?: string;
      }
    | {
        error?: {
          message?: string;
        };
      }
    | null;

  if (!response.ok) {
    throw new AppError(
      502,
      "OPENAI_SCENARIO_CALL_FAILED",
      payload && "error" in payload ? payload.error?.message || "OpenAI scenario request failed." : "OpenAI scenario request failed."
    );
  }

  const text = payload && "output_text" in payload ? payload.output_text || "" : "";

  if (!text.trim()) {
    throw new AppError(502, "OPENAI_EMPTY_RESPONSE", "OpenAI scenario response was empty.");
  }

  return text.trim();
}

async function callGeminiText(prompt: string): Promise<string> {
  if (!config.geminiApiKey) {
    throw new AppError(500, "GEMINI_API_KEY_MISSING", "GEMINI_API_KEY is not configured.");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.geminiModel)}:generateContent?key=${encodeURIComponent(config.geminiApiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ]
    })
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              text?: string;
            }>;
          };
        }>;
        error?: {
          message?: string;
        };
      }
    | null;

  if (!response.ok) {
    throw new AppError(
      502,
      "GEMINI_SCENARIO_CALL_FAILED",
      payload?.error?.message || "Gemini scenario request failed."
    );
  }

  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n").trim() || "";

  if (!text) {
    throw new AppError(502, "GEMINI_EMPTY_RESPONSE", "Gemini scenario response was empty.");
  }

  return text;
}

async function transcribeWithOpenAi(context: ScenarioVoiceContext): Promise<string> {
  if (!config.openAiApiKey) {
    throw new AppError(500, "OPENAI_API_KEY_MISSING", "OPENAI_API_KEY is not configured.");
  }

  const audioBuffer = Buffer.from(context.audioBase64, "base64");
  const form = new FormData();
  form.append("model", config.openAiTranscriptionModel);
  form.append("file", new Blob([audioBuffer], { type: context.mimeType }), context.fileName);

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openAiApiKey}`
    },
    body: form
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        text?: string;
        error?: {
          message?: string;
        };
      }
    | null;

  if (!response.ok) {
    throw new AppError(502, "OPENAI_TRANSCRIPTION_FAILED", payload?.error?.message || "OpenAI transcription request failed.");
  }

  const transcript = payload?.text?.trim() || "";

  if (!transcript) {
    throw new AppError(502, "OPENAI_TRANSCRIPTION_EMPTY", "OpenAI transcription response was empty.");
  }

  return transcript;
}

async function assessPronunciationFromTranscript(input: {
  provider: "openai" | "gemini";
  transcript: string;
  referenceText?: string;
}): Promise<PronunciationAssessment> {
  const prompt = [
    "You are grading a language learner's spoken attempt.",
    "Return JSON only with keys overallScore, accuracyScore, fluencyScore, feedback.",
    "Scores must be integers 0-100.",
    input.referenceText ? `Expected phrase: ${input.referenceText}` : "No expected phrase was provided. Judge only clarity and likely pronunciation quality from the transcript.",
    `Learner transcript: ${input.transcript}`,
    "Feedback must be one short coaching sentence."
  ].join("\n");

  const providerText =
    input.provider === "openai" ? await callOpenAiText(prompt) : await callGeminiText(prompt);

  return normalizePronunciation(JSON.parse(extractJsonObject(providerText)), "transcript");
}

async function analyzeVoiceTurnWithGemini(context: ScenarioVoiceContext): Promise<ScenarioVoiceResult> {
  if (!config.geminiApiKey) {
    throw new AppError(500, "GEMINI_API_KEY_MISSING", "GEMINI_API_KEY is not configured.");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.geminiAudioModel)}:generateContent?key=${encodeURIComponent(config.geminiApiKey)}`;
  const prompt = [
    `You are ${context.tutorName}, a Hebrew tutor for Daber.`,
    `Tutor style: ${context.tutorSubtitle || "Warm, patient, direct."}`,
    `Scenario theme: ${context.themeTitle} (${context.themeId}).`,
    `Situation: ${context.situation}`,
    context.referenceText ? `Target phrase the learner intended to say: ${context.referenceText}` : "",
    "Analyze the audio and return JSON only.",
    "Required JSON keys: transcript, pronunciation, tutorReply, translation.",
    "pronunciation must include overallScore, accuracyScore, fluencyScore, feedback.",
    "Scores must be integers 0-100.",
    "tutorReply should be a short, natural tutor turn suitable for a live spoken roleplay.",
    "tutorReply must be Hebrew only.",
    "translation must be a concise support translation in the learner native language only.",
    context.native ? `Learner native language: ${context.native}` : "Learner native language: English"
  ]
    .filter(Boolean)
    .join("\n");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: context.mimeType,
                data: context.audioBase64
              }
            }
          ]
        }
      ]
    })
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              text?: string;
            }>;
          };
        }>;
        error?: {
          message?: string;
        };
      }
    | null;

  if (!response.ok) {
    throw new AppError(502, "GEMINI_VOICE_ANALYSIS_FAILED", payload?.error?.message || "Gemini voice analysis request failed.");
  }

  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n").trim() || "";

  if (!text) {
    throw new AppError(502, "GEMINI_VOICE_ANALYSIS_EMPTY", "Gemini voice analysis response was empty.");
  }

  const parsed = JSON.parse(extractJsonObject(text)) as {
    transcript?: string;
    pronunciation?: unknown;
    tutorReply?: string;
    translation?: string;
  };
  const transcript = parsed.transcript?.trim() || "";

  if (!transcript) {
    throw new AppError(502, "GEMINI_TRANSCRIPT_EMPTY", "Gemini did not return a transcript.");
  }

  return {
    transcript,
    pronunciation: normalizePronunciation(parsed.pronunciation, "audio"),
    tutorReply: {
      text: parsed.tutorReply?.trim() || "Tell me that one more time, slowly.",
      translation: parsed.translation?.trim() || null,
      provider: "gemini",
      model: config.geminiAudioModel,
      liveModelCall: true
    }
  };
}

async function transcribeWithGemini(context: ScenarioVoiceContext): Promise<string> {
  if (!config.geminiApiKey) {
    throw new AppError(500, "GEMINI_API_KEY_MISSING", "GEMINI_API_KEY is not configured.");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.geminiAudioModel)}:generateContent?key=${encodeURIComponent(config.geminiApiKey)}`;
  const prompt = [
    "Transcribe this learner audio for a Hebrew learning app.",
    "Return JSON only with key transcript.",
    "Preserve Hebrew text if spoken in Hebrew.",
    "Do not include any explanation."
  ].join("\n");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: context.mimeType,
                data: context.audioBase64
              }
            }
          ]
        }
      ]
    })
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              text?: string;
            }>;
          };
        }>;
        error?: {
          message?: string;
        };
      }
    | null;

  if (!response.ok) {
    throw new AppError(502, "GEMINI_TRANSCRIPTION_FAILED", payload?.error?.message || "Gemini transcription request failed.");
  }

  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n").trim() || "";

  if (!text) {
    throw new AppError(502, "GEMINI_TRANSCRIPTION_EMPTY", "Gemini transcription response was empty.");
  }

  const parsed = JSON.parse(extractJsonObject(text)) as { transcript?: unknown };
  const transcript = typeof parsed.transcript === "string" ? parsed.transcript.trim() : "";

  if (!transcript) {
    throw new AppError(502, "GEMINI_TRANSCRIPT_EMPTY", "Gemini did not return a transcript.");
  }

  return transcript;
}

export async function generateScenarioTutorReply(context: ScenarioTutorContext): Promise<ScenarioProviderResult> {
  const prompt = buildPrompt(context);
  if (context.provider === "openai") {
    const text = await callOpenAiText(prompt);
    return normalizeScenarioReply(text, "openai", config.openAiModel);
  }

  const text = await callGeminiText(prompt);
  return normalizeScenarioReply(text, "gemini", config.geminiModel);
}

export async function transcribeScenarioVoice(context: ScenarioVoiceContext): Promise<ScenarioVoiceTranscriptResult> {
  const transcript =
    context.provider === "openai" ? await transcribeWithOpenAi(context) : await transcribeWithGemini(context);

  return { transcript };
}

export async function generateScenarioVoiceReplyFromTranscript(
  context: Omit<ScenarioVoiceContext, "audioBase64" | "mimeType" | "fileName" | "learnerMessage"> & {
    transcript: string;
  }
): Promise<Omit<ScenarioVoiceResult, "transcript">> {
  const [pronunciation, tutorReply] = await Promise.all([
    assessPronunciationFromTranscript({
      provider: context.provider,
      transcript: context.transcript,
      referenceText: context.referenceText
    }),
    generateScenarioTutorReply({
      provider: context.provider,
      tutorName: context.tutorName,
      tutorSubtitle: context.tutorSubtitle,
      themeTitle: context.themeTitle,
      themeId: context.themeId,
      situation: context.situation,
      level: context.level,
      goal: context.goal,
      native: context.native,
      starterLine: context.starterLine,
      priorTurns: context.priorTurns,
      learnerMessage: context.transcript
    })
  ]);

  return {
    pronunciation,
    tutorReply
  };
}

export async function generateScenarioVoiceReply(context: ScenarioVoiceContext): Promise<ScenarioVoiceResult> {
  if (context.provider === "gemini") {
    return analyzeVoiceTurnWithGemini(context);
  }

  const { transcript } = await transcribeScenarioVoice(context);
  const { pronunciation, tutorReply } = await generateScenarioVoiceReplyFromTranscript({
    provider: "openai",
    tutorName: context.tutorName,
    tutorSubtitle: context.tutorSubtitle,
    themeTitle: context.themeTitle,
    themeId: context.themeId,
    situation: context.situation,
    level: context.level,
    goal: context.goal,
    native: context.native,
    starterLine: context.starterLine,
    priorTurns: context.priorTurns,
    referenceText: context.referenceText,
    transcript
  });

  return {
    transcript,
    pronunciation,
    tutorReply
  };
}
