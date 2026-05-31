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
  voice?: string | null;
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

type ScenarioTranslationResult = {
  translation: string;
  provider: "gemini" | "openai";
  model: string;
  liveModelCall: boolean;
};

type ScenarioSpeechResult = {
  audioBase64: string;
  mimeType: string;
  provider: "openai";
  model: string;
  voice: string;
  liveModelCall: boolean;
};

type PronunciationIssue = {
  label: string;
  issueCount: number;
  severity: "low" | "medium" | "high";
  affectedWord: string;
  expectedSound: string;
  heardApproximation: string;
  hint: string;
};

type PronunciationAssessment = {
  overallScore: number;
  accuracyScore: number;
  fluencyScore: number;
  feedback: string;
  scoringMode: "audio" | "transcript";
  issues: PronunciationIssue[];
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

function normalizeLevel(level?: string | null): string {
  return (level || "").trim().toUpperCase();
}

export function buildLearnerInstructionSummary(context: Pick<ScenarioTutorContext, "level" | "goal" | "native" | "voice">): string {
  const level = normalizeLevel(context.level);
  const goal = (context.goal || "").trim().toLowerCase();
  const native = (context.native || "").trim();
  const voice = (context.voice || "").trim();
  const isBeginner = level === "A1" || level === "A2" || level.includes("BEGINNER");
  const isIntermediate = level === "B1" || level === "B2" || level.includes("INTERMEDIATE");
  const isAdvanced = level.startsWith("C") || level.includes("ADVANCED");

  const profileBits = [
    `native=${native || "unknown"}`,
    `level=${level || "unknown"}`,
    `goal=${goal || "unknown"}`,
    `voice=${voice || "unknown"}`
  ];

  const guidance: string[] = [];

  if (native && native !== "Other") {
    guidance.push(`Use ${native} only for support text.`);
  } else {
    guidance.push("Use English for support text.");
  }

  if (isBeginner) {
    guidance.push("Keep Hebrew simple, concrete, and easy to reuse.");
    guidance.push("Prefer 2-4 short sentences with one clear example when helpful.");
  } else if (isIntermediate) {
    guidance.push("Keep the reply tight and practical.");
    guidance.push("Prefer 1-3 short sentences with one useful correction or detail.");
  } else if (isAdvanced) {
    guidance.push("Keep the Hebrew natural and avoid over-explaining.");
    guidance.push("Use nuance when it helps the scenario.");
  }

  switch (goal) {
    case "travel":
      guidance.push("Favor street Hebrew, directions, ordering, and quick real-world exchanges.");
      break;
    case "family":
      guidance.push("Favor warm, personal, everyday Hebrew and relationship-friendly phrasing.");
      break;
    case "work":
      guidance.push("Favor professional, polite, and clear Hebrew for workplace communication.");
      break;
    case "culture":
      guidance.push("Favor idioms, expression, nuance, and natural conversational Hebrew.");
      break;
    default:
      break;
  }

  return `Learner profile: ${profileBits.join(", ")}. ${guidance.join(" ")}`.trim();
}

function buildLearnerProfileLines(context: Pick<ScenarioTutorContext, "level" | "goal" | "native" | "voice">): string[] {
  const level = normalizeLevel(context.level);
  const goal = (context.goal || "").trim().toLowerCase();
  const native = (context.native || "").trim();
  const voice = (context.voice || "").trim();
  const isBeginner = level === "A1" || level === "A2" || level.includes("BEGINNER");
  const isIntermediate = level === "B1" || level === "B2" || level.includes("INTERMEDIATE");
  const isAdvanced = level.startsWith("C") || level.includes("ADVANCED");

  const lines = [buildLearnerInstructionSummary(context)];

  if (native && native !== "Other") {
    lines.push(`Use ${native} only for translation and support text, never inside the Hebrew reply.`);
  } else {
    lines.push("Use English for support translation when the learner native language is missing or set to Other.");
  }

  if (isBeginner) {
    lines.push("The learner is a beginner, so keep Hebrew simple, concrete, and easy to reuse.");
    lines.push("Prefer 2-4 short sentences and add one clear example when helpful.");
  } else if (isIntermediate) {
    lines.push("The learner is intermediate, so keep the reply tight and practical.");
    lines.push("Prefer 1-3 short sentences and only one useful correction or detail unless more is needed.");
  } else if (isAdvanced) {
    lines.push("The learner is advanced, so keep the Hebrew natural and avoid over-explaining.");
    lines.push("Use nuance, but stay relevant to the scenario.");
  }

  switch (goal) {
    case "travel":
      lines.push("The learner is studying for travel, so favor practical street Hebrew, directions, ordering, and quick real-world exchanges.");
      break;
    case "family":
      lines.push("The learner is studying for family conversations, so favor warm, personal, everyday Hebrew and relationship-friendly phrasing.");
      break;
    case "work":
      lines.push("The learner is studying for work, so favor professional, polite, and clear Hebrew that fits workplace communication.");
      break;
    case "culture":
      lines.push("The learner is studying for culture, so favor idioms, expression, nuance, and natural conversational Hebrew when useful.");
      break;
    default:
      break;
  }

  return lines;
}

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
    ...buildLearnerProfileLines(context),
    "Reply with the best possible tutor answer for this exact situation.",
    "Make the reply natural, direct, and useful enough to move the conversation forward.",
    "Prefer clarity over brevity when the learner needs explanation.",
    "If the learner asks a question, answer it clearly and completely.",
    "If the learner makes a mistake, correct it gently and show the better version in natural Hebrew.",
    "Use the learner profile and scenario context to choose the right amount of detail.",
    "If a shorter reply is enough, keep it short; otherwise add one helpful detail or example.",
    "Avoid generic filler, repetition, and vague encouragement.",
    "Keep the reply supportive and scenario-specific.",
    "Return JSON only with keys reply and translation.",
    "reply must be Hebrew only.",
    "translation must be a concise support translation in the learner native language only.",
    "Never include the learner native language, English, or transliteration inside reply.",
    "All non-Hebrew support text must go in translation only.",
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

function extractOpenAiText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const pieces: string[] = [];
  const visited = new Set<object>();

  const visit = (value: unknown, key?: string): void => {
    if (!value) {
      return;
    }

    if (typeof value === "string") {
      const text = value.trim();
      if (!text) {
        return;
      }

      if (!key || key === "text" || key === "output_text" || key === "content") {
        pieces.push(text);
      }
      return;
    }

    if (typeof value !== "object") {
      return;
    }

    if (visited.has(value)) {
      return;
    }

    visited.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      if (childKey === "error" || childKey === "usage") {
        continue;
      }
      visit(childValue, childKey);
    }
  };

  visit(payload);

  const unique = pieces.filter((piece, index) => pieces.indexOf(piece) === index);
  return unique.join("\n").trim();
}

function normalizePronunciation(value: unknown, scoringMode: "audio" | "transcript"): PronunciationAssessment {
  const parsed = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const rawIssues = Array.isArray(parsed.issues) ? parsed.issues : [];
  const normalizedIssues = rawIssues
    .map((item) => {
      const issue = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const label = typeof issue.label === "string" && issue.label.trim() ? issue.label.trim().toUpperCase() : "SOUND";
      const issueCount = Math.max(1, clampScore(issue.issueCount) || 1);
      const severity =
        issue.severity === "high" || issue.severity === "low" || issue.severity === "medium" ? issue.severity : "medium";
      const affectedWord = typeof issue.affectedWord === "string" && issue.affectedWord.trim() ? issue.affectedWord.trim() : "Unknown";
      const expectedSound = typeof issue.expectedSound === "string" && issue.expectedSound.trim() ? issue.expectedSound.trim() : "target sound";
      const heardApproximation =
        typeof issue.heardApproximation === "string" && issue.heardApproximation.trim() ? issue.heardApproximation.trim() : "unclear";
      const hint =
        typeof issue.hint === "string" && issue.hint.trim() ? issue.hint.trim() : "Repeat the target sound more clearly.";

      return {
        label,
        issueCount,
        severity,
        affectedWord,
        expectedSound,
        heardApproximation,
        hint
      } satisfies PronunciationIssue;
    })
    .slice(0, 4);
  const issues = normalizedIssues.sort((left, right) => {
    const leftTzadi = left.label === "TZADI" ? 1 : 0;
    const rightTzadi = right.label === "TZADI" ? 1 : 0;

    if (leftTzadi !== rightTzadi) {
      return rightTzadi - leftTzadi;
    }

    const severityRank = { high: 3, medium: 2, low: 1 } as const;
    const severityDelta = severityRank[right.severity] - severityRank[left.severity];

    if (severityDelta !== 0) {
      return severityDelta;
    }

    return right.issueCount - left.issueCount;
  });

  const feedback =
    typeof parsed.feedback === "string" && parsed.feedback.trim()
      ? parsed.feedback.trim()
      : issues[0]
        ? `${issues[0].label}: ${issues[0].hint}`
        : "Keep the sentence shorter and stress the key word more clearly.";

  return {
    overallScore: clampScore(parsed.overallScore),
    accuracyScore: clampScore(parsed.accuracyScore),
    fluencyScore: clampScore(parsed.fluencyScore),
    feedback,
    scoringMode,
    issues
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
      input: prompt,
      temperature: 0
    })
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        output_text?: string;
        output?: Array<{
          content?: Array<{
            text?: string;
          }>;
        }>;
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

  const text = extractOpenAiText(payload);

  if (!text.trim()) {
    throw new AppError(502, "OPENAI_EMPTY_RESPONSE", `OpenAI scenario response was empty or had an unexpected shape. Keys: ${Object.keys((payload as Record<string, unknown>) || {}).join(", ") || "none"}`);
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
      ],
      generationConfig: { temperature: 0 }
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
    "Return JSON only with keys overallScore, accuracyScore, fluencyScore, feedback, issues.",
    "Scores must be integers 0-100.",
    "issues must be an array with up to 4 objects.",
    "Each issue object must contain: label, issueCount, severity, affectedWord, expectedSound, heardApproximation, hint.",
    "severity must be one of low, medium, high.",
    "If a tzadi pronunciation issue is present, label it exactly TZADI and include it in issues.",
    "Prioritize TZADI as the top issue when it is present.",
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
    ...buildLearnerProfileLines(context),
    context.referenceText ? `Target phrase the learner intended to say: ${context.referenceText}` : "",
    "Analyze the audio and return JSON only.",
    "Required JSON keys: transcript, pronunciation, tutorReply, translation.",
    "pronunciation must include overallScore, accuracyScore, fluencyScore, feedback, issues.",
    "issues must be an array with up to 4 objects.",
    "Each issue object must contain: label, issueCount, severity, affectedWord, expectedSound, heardApproximation, hint.",
    "If a tzadi pronunciation issue is present, label it exactly TZADI and include it in issues.",
    "Prioritize TZADI as the top issue when it is present.",
    "Scores must be integers 0-100.",
    "tutorReply should be the best possible tutor answer for this situation, natural and useful.",
    "Prefer clarity over brevity when the learner needs explanation.",
    "If the learner asks a question, answer it clearly and fully enough to help right away.",
    "If the learner makes a mistake, correct it gently and show the better version in natural Hebrew.",
    "Use the scenario context and learner profile to choose the right detail level.",
    "Avoid generic filler, repetition, and vague encouragement.",
    "tutorReply must be Hebrew only.",
    "translation must be a concise support translation in the learner native language only.",
    "Never include the learner native language, English, or transliteration inside tutorReply.",
    "All non-Hebrew support text must go in translation only.",
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
      ],
      generationConfig: { temperature: 0 }
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
      ],
      generationConfig: { temperature: 0 }
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

export async function generateSupportTranslation(input: {
  provider: "gemini" | "openai";
  native?: string | null;
  text: string;
}): Promise<ScenarioTranslationResult> {
  const prompt = [
    "Translate this Hebrew tutor line into the learner support language.",
    `Support language: ${input.native && input.native !== "Other" ? input.native : "English"}`,
    "Return JSON only with key translation.",
    "Keep the translation concise, natural, and faithful to the Hebrew meaning.",
    `Hebrew tutor line: ${input.text}`
  ].join("\n");

  const model = input.provider === "openai" ? config.openAiModel : config.geminiModel;
  const rawText = input.provider === "openai" ? await callOpenAiText(prompt) : await callGeminiText(prompt);

  try {
    const parsed = JSON.parse(extractJsonObject(rawText)) as { translation?: unknown };
    const translation = typeof parsed.translation === "string" ? parsed.translation.trim() : "";

    if (translation) {
      return {
        translation,
        provider: input.provider,
        model,
        liveModelCall: true
      };
    }
  } catch {
    // Fall through to plain-text fallback.
  }

  return {
    translation: rawText.trim(),
    provider: input.provider,
    model,
    liveModelCall: true
  };
}

export async function generateTutorSpeech(input: {
  text: string;
  tutorName?: string;
}): Promise<ScenarioSpeechResult> {
  if (!config.openAiApiKey) {
    throw new AppError(500, "OPENAI_API_KEY_MISSING", "OPENAI_API_KEY is not configured.");
  }

  const voice =
    input.tutorName === "Noam" ? "sage" : input.tutorName === "Shira" ? "verse" : config.openAiTtsVoice;

  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openAiApiKey}`
    },
    body: JSON.stringify({
      model: config.openAiTtsModel,
      voice,
      input: input.text,
      response_format: "mp3",
      instructions: "Speak naturally in Hebrew. Keep the pacing conversational and clear."
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new AppError(502, "OPENAI_TTS_FAILED", errorText || "OpenAI speech generation failed.");
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());

  return {
    audioBase64: audioBuffer.toString("base64"),
    mimeType: "audio/mpeg",
    provider: "openai",
    model: config.openAiTtsModel,
    voice,
    liveModelCall: true
  };
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
      voice: context.voice,
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
    voice: context.voice,
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
