import { createHash, randomUUID } from "crypto";
import { Router } from "express";
import { FieldValue } from "firebase-admin/firestore";
import admin from "../firebaseAdmin";
import { AppError } from "../errors";
import { asyncHandler } from "../middleware/asyncHandler";
import { authenticateFirebaseUser } from "../middleware/authenticateFirebaseUser";
import { ensureUserDocument } from "../userProfile";
import { config } from "../config";
import {
  findTheme,
  getTodayThemeId,
  SCENARIO_THEMES,
  TUTOR_VOICES,
  TutorVoiceId
} from "../scenarioCatalog";
import {
  generateScenarioTutorReply,
  generateSupportTranslation,
  generateTutorSpeech,
  generateScenarioVoiceReply,
  generateScenarioVoiceReplyFromTranscript,
  transcribeScenarioVoice
} from "../scenarioProviders";

type LaunchBody = {
  themeId?: string;
  provider?: "gemini" | "openai";
  forceNew?: boolean;
};

type ScenarioMessageBody = {
  message?: string;
};

type ScenarioVoiceBody = {
  audioBase64?: string;
  mimeType?: string;
  fileName?: string;
  referenceText?: string;
};

type ScenarioVoiceRespondBody = {
  transcript?: string;
  referenceText?: string;
};

type ScenarioTranslationBody = {
  text?: string;
  native?: string;
};

type ScenarioSpeechBody = {
  text?: string;
};

const router = Router();
const db = admin.firestore();

function getTutorVoiceId(value: unknown): TutorVoiceId {
  return value === "noam" || value === "shira" ? value : "dana";
}

function pickRandom<T>(items: T[]): T {
  if (items.length === 0) {
    throw new AppError(500, "EMPTY_SCENARIO_COLLECTION", "Scenario collection was unexpectedly empty.");
  }

  return items[Math.floor(Math.random() * items.length)] as T;
}

function buildStarterLine(themeId: string, tutorName: string): string {
  if (themeId === "supermarket") {
    return `${tutorName}: Hi, welcome to the supermarket. What are you looking for today?`;
  }

  if (themeId === "shuk") {
    return `${tutorName}: Welcome to the Friday market. Want help finding something or comparing prices?`;
  }

  if (themeId === "cafe") {
    return `${tutorName}: Hi, what can I get started for you?`;
  }

  return `${tutorName}: Let's begin. Tell me what you need.`;
}

function buildMockTutorReply(input: {
  tutorName: string;
  themeId: string;
  learnerMessage: string;
  provider: "gemini" | "openai";
}): string {
  if (input.themeId === "supermarket") {
    return `${input.tutorName}: Got it. In the supermarket, a natural next step is to ask where the item is or how much it costs.`;
  }

  if (input.themeId === "shuk") {
    return `${input.tutorName}: In the Friday market, keep it short and direct. You can ask about price, freshness, or quantity.`;
  }

  if (input.themeId === "cafe") {
    return `${input.tutorName}: In the café, that works. A useful follow-up is your drink size or whether you want it to stay or go.`;
  }

  return `${input.tutorName}: Let's keep building the conversation naturally.`;
}

function buildMockTutorReplyPayload(input: {
  tutorName: string;
  themeId: string;
  learnerMessage: string;
  provider: "gemini" | "openai";
}): { text: string; translation: string | null } {
  if (input.themeId === "supermarket") {
    return {
      text: "בסדר. עכשיו תשאל איפה המוצר נמצא או כמה הוא עולה.",
      translation: "Okay. Now ask where the item is or how much it costs."
    };
  }

  if (input.themeId === "shuk") {
    return {
      text: "יופי. בשוק עדיף לדבר קצר וברור. עכשיו תשאל על המחיר או על הכמות.",
      translation: "Good. In the Friday market, keep it short and direct. Now ask about the price or quantity."
    };
  }

  if (input.themeId === "cafe") {
    return {
      text: "מעולה. עכשיו תוכל לשאול על הגודל או אם זה לקחת או לשבת.",
      translation: "Great. Now you can ask about the size or whether it is to stay or take away."
    };
  }

  return {
    text: "שמעתי אותך. בוא נמשיך את השיחה בצורה טבעית.",
    translation: "I heard you. Let's keep building the conversation naturally."
  };
}

function getRequiredParam(value: string | string[] | undefined, name: string): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  throw new AppError(400, "MISSING_ROUTE_PARAM", `Missing required route parameter: ${name}.`);
}

function getCurrentNativeLanguage(userData: unknown, session: Record<string, any>): string | null {
  const onboarding = userData && typeof userData === "object" ? (userData as { onboarding?: { native?: string } }).onboarding : undefined;
  return onboarding?.native || session.learnerProfile?.native || null;
}

function getSupportTranslationKey(text: string): string {
  return createHash("sha1").update(text.trim()).digest("hex");
}

function isHebrewOnlyInput(text: string): boolean {
  const trimmed = text.trim();

  if (!trimmed) {
    return false;
  }

  return !/[A-Za-z]/.test(trimmed) && /^[\u0590-\u05FF0-9\s.,!?'"():;+\-/%]+$/u.test(trimmed);
}

async function getOwnedSession(userUid: string, sessionId: string) {
  const sessionRef = db.collection("users").doc(userUid).collection("scenarioSessions").doc(sessionId);
  const snapshot = await sessionRef.get();

  if (!snapshot.exists) {
    throw new AppError(404, "SCENARIO_SESSION_NOT_FOUND", "Scenario session not found.", { sessionId });
  }

  return { sessionRef, snapshot };
}

async function findReusableThemeSession(userUid: string, themeId: string, provider: "gemini" | "openai") {
  const snapshots = await db.collection("users").doc(userUid).collection("scenarioSessions").get();

  const reusable = snapshots.docs
    .map((doc) => ({ id: doc.id, data: doc.data() }))
    .filter((entry) => entry.data?.theme?.id === themeId && entry.data?.provider === provider)
    .sort((left, right) => {
      const leftMillis = left.data?.updatedAt?.toMillis?.() ?? left.data?.createdAt?.toMillis?.() ?? 0;
      const rightMillis = right.data?.updatedAt?.toMillis?.() ?? right.data?.createdAt?.toMillis?.() ?? 0;
      return rightMillis - leftMillis;
    })[0];

  return reusable || null;
}

/**
 * @openapi
 * /scenarios/themes:
 *   get:
 *     tags:
 *       - Scenarios
 *     summary: List available scenario themes from the prototype catalog
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Scenario themes returned
 *       401:
 *         description: Missing or invalid Firebase token
 */
router.get(
  "/themes",
  authenticateFirebaseUser,
  asyncHandler(async (req, res) => {
    if (!req.firebaseUser) {
      throw new AppError(401, "UNAUTHENTICATED", "Authenticated user was not attached to the request.");
    }

    const { snapshot: userSnapshot } = await ensureUserDocument(req.firebaseUser);

    res.status(200).json({
      status: true,
      message: "Scenario themes fetched successfully.",
      details: {
        todayThemeId: getTodayThemeId(),
        items: SCENARIO_THEMES.map((theme) => ({
          id: theme.id,
          title: theme.title,
          he: theme.he,
          heChar: theme.heChar,
          band: theme.band,
          blurb: theme.blurb,
          palette: theme.palette,
          locked: Boolean(theme.locked)
        }))
      }
    });
  })
);

/**
 * @openapi
 * /scenarios/launch:
 *   post:
 *     tags:
 *       - Scenarios
 *     summary: Launch a scenario using the user's onboarding-selected voice
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               themeId:
 *                 type: string
 *                 example: supermarket
 *               provider:
 *                 type: string
 *                 enum: [gemini, openai]
 *     responses:
 *       200:
 *         description: Scenario launch payload
 *       400:
 *         description: Invalid theme or locked theme
 *       401:
 *         description: Missing or invalid Firebase token
 */
router.post(
  "/launch",
  authenticateFirebaseUser,
  asyncHandler(async (req, res) => {
    if (!req.firebaseUser) {
      throw new AppError(401, "UNAUTHENTICATED", "Authenticated user was not attached to the request.");
    }

    const body = (req.body ?? {}) as LaunchBody;
    const themeId = typeof body.themeId === "string" ? body.themeId.trim() : "";
    const provider = body.provider === "openai" ? "openai" : body.provider === "gemini" ? "gemini" : config.scenarioProviderDefault;
    const forceNew = body.forceNew === true;

    if (!themeId) {
      throw new AppError(400, "MISSING_THEME_ID", "Scenario launch requires a themeId.");
    }

    const theme = findTheme(themeId);

    if (!theme) {
      throw new AppError(400, "UNKNOWN_THEME", "Scenario theme was not found.", { themeId });
    }

    if (theme.locked) {
      throw new AppError(400, "LOCKED_THEME", "Scenario theme is locked.", { themeId });
    }

    const { ref: userRef, snapshot } = await ensureUserDocument(req.firebaseUser);
    const userData = snapshot.data() || {};
    const onboarding = (userData.onboarding || {}) as { voice?: string; native?: string; level?: string; goal?: string };
    const tutorVoice = TUTOR_VOICES[getTutorVoiceId(onboarding.voice)];

    const reusableSession = forceNew ? null : await findReusableThemeSession(req.firebaseUser.uid, theme.id, provider);

    if (reusableSession) {
      await userRef.collection("scenarioSessions").doc(reusableSession.id).set(
        {
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      res.status(200).json({
        status: true,
        message: "Scenario session reused successfully.",
        details: reusableSession.data
      });
      return;
    }

    const ct = pickRandom(theme.cts);
    const variation = pickRandom(ct.variations);
    const sessionId = randomUUID();

    const payload = {
      sessionId,
      provider,
      providerConfigured: provider === "openai" ? Boolean(config.openAiApiKey) : Boolean(config.geminiApiKey),
      theme: {
        id: theme.id,
        title: theme.title,
        he: theme.he,
        heChar: theme.heChar,
        band: theme.band,
        blurb: theme.blurb
      },
      ct: {
        id: ct.id,
        title: ct.title,
        turns: ct.turns
      },
      variation,
      tutorVoice,
      learnerProfile: {
        native: onboarding.native || null,
        level: onboarding.level || null,
        goal: onboarding.goal || null
      },
      conversation: {
        title: `${tutorVoice.name} · ${theme.title}`,
        starterLine: buildStarterLine(theme.id, tutorVoice.name),
        promptSeed: `Theme: ${theme.title}. Situation: ${variation.situation}. Tutor voice: ${tutorVoice.name}.`
      }
    };

    await userRef.collection("scenarioSessions").doc(sessionId).set(
      {
        ...payload,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    res.status(200).json({
      status: true,
      message: "Scenario launched successfully.",
      details: payload
    });
  })
);

/**
 * @openapi
 * /scenarios/sessions/{sessionId}:
 *   get:
 *     tags:
 *       - Scenarios
 *     summary: Get a launched scenario session
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Scenario session returned
 *       401:
 *         description: Missing or invalid Firebase token
 *       404:
 *         description: Scenario session not found
 */
router.get(
  "/sessions/:sessionId",
  authenticateFirebaseUser,
  asyncHandler(async (req, res) => {
    if (!req.firebaseUser) {
      throw new AppError(401, "UNAUTHENTICATED", "Authenticated user was not attached to the request.");
    }

    await ensureUserDocument(req.firebaseUser);
    const sessionId = getRequiredParam(req.params.sessionId, "sessionId");
    const { snapshot } = await getOwnedSession(req.firebaseUser.uid, sessionId);

    res.status(200).json({
      status: true,
      message: "Scenario session fetched successfully.",
      details: snapshot.data()
    });
  })
);

/**
 * @openapi
 * /scenarios/sessions/{sessionId}/message:
 *   post:
 *     tags:
 *       - Scenarios
 *     summary: Add a learner message to a scenario session and get a tutor reply
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               message:
 *                 type: string
 *                 example: I am looking for eggs, please.
 *     responses:
 *       200:
 *         description: Scenario tutor reply
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Missing or invalid Firebase token
 *       404:
 *         description: Scenario session not found
 */
router.post(
  "/sessions/:sessionId/speech",
  authenticateFirebaseUser,
  asyncHandler(async (req, res) => {
    if (!req.firebaseUser) {
      throw new AppError(401, "UNAUTHENTICATED", "Authenticated user was not attached to the request.");
    }

    await ensureUserDocument(req.firebaseUser);
    const sessionId = getRequiredParam(req.params.sessionId, "sessionId");
    const body = (req.body ?? {}) as ScenarioSpeechBody;
    const text = typeof body.text === "string" ? body.text.trim() : "";

    if (!text) {
      throw new AppError(400, "MISSING_SPEECH_TEXT", "Tutor speech generation requires a non-empty text field.");
    }

    const { snapshot } = await getOwnedSession(req.firebaseUser.uid, sessionId);
    const session = snapshot.data() || {};
    const tutorVoice = session.tutorVoice || { name: "Dana" };
    const speech = await generateTutorSpeech({
      text,
      tutorName: tutorVoice.name || "Dana"
    });

    res.status(200).json({
      status: true,
      message: "Tutor speech generated successfully.",
      details: speech
    });
  })
);

router.post(
  "/sessions/:sessionId/translate",
  authenticateFirebaseUser,
  asyncHandler(async (req, res) => {
    if (!req.firebaseUser) {
      throw new AppError(401, "UNAUTHENTICATED", "Authenticated user was not attached to the request.");
    }

    const { snapshot: userSnapshot } = await ensureUserDocument(req.firebaseUser);
    const sessionId = getRequiredParam(req.params.sessionId, "sessionId");
    const body = (req.body ?? {}) as ScenarioTranslationBody;
    const text = typeof body.text === "string" ? body.text.trim() : "";

    if (!text) {
      throw new AppError(400, "MISSING_TRANSLATION_TEXT", "Support translation requires a non-empty text field.");
    }

    const { sessionRef, snapshot } = await getOwnedSession(req.firebaseUser.uid, sessionId);
    const session = snapshot.data() || {};
    const provider = session.provider === "openai" ? "openai" : "gemini";
    const native = (typeof body.native === "string" && body.native.trim()) || getCurrentNativeLanguage(userSnapshot.data(), session) || "English";
    const translationKey = getSupportTranslationKey(text);
    const storedTranslation = session.supportTranslations?.[native]?.[translationKey];
    const cachedTranslation =
      typeof storedTranslation === "string"
        ? storedTranslation.trim()
        : typeof storedTranslation?.translation === "string"
          ? storedTranslation.translation.trim()
          : "";

    if (cachedTranslation) {
      res.status(200).json({
        status: true,
        message: "Support translation loaded from session cache.",
        details: {
          translation: cachedTranslation,
          provider,
          model: provider === "openai" ? config.openAiModel : config.geminiModel,
          liveModelCall: false
        }
      });
      return;
    }

    const translation = await generateSupportTranslation({
      provider,
      native,
      text
    });

    await sessionRef.set(
      {
        supportTranslations: {
          [native]: {
            [translationKey]: {
              sourceText: text,
              translation: translation.translation
            }
          }
        },
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    res.status(200).json({
      status: true,
      message: "Support translation generated successfully.",
      details: translation
    });
  })
);

router.post(
  "/sessions/:sessionId/message",
  authenticateFirebaseUser,
  asyncHandler(async (req, res) => {
    if (!req.firebaseUser) {
      throw new AppError(401, "UNAUTHENTICATED", "Authenticated user was not attached to the request.");
    }

    const { snapshot: userSnapshot } = await ensureUserDocument(req.firebaseUser);
    const sessionId = getRequiredParam(req.params.sessionId, "sessionId");
    const body = (req.body ?? {}) as ScenarioMessageBody;
    const message = typeof body.message === "string" ? body.message.trim() : "";

    if (!message) {
      throw new AppError(400, "MISSING_SCENARIO_MESSAGE", "Scenario message requires a non-empty message field.");
    }

    if (!isHebrewOnlyInput(message)) {
      throw new AppError(400, "SCENARIO_MESSAGE_MUST_BE_HEBREW", "Scenario learner text must be Hebrew only.");
    }

    const { sessionRef, snapshot } = await getOwnedSession(req.firebaseUser.uid, sessionId);
    const session = snapshot.data() || {};
    const native = getCurrentNativeLanguage(userSnapshot.data(), session);
    const provider = session.provider === "openai" ? "openai" : "gemini";
    const tutorVoice = session.tutorVoice || { name: "Dana" };
    const theme = session.theme || { id: "supermarket" };
    const model = provider === "openai" ? config.openAiModel : config.geminiModel;
    const providerConfigured = provider === "openai" ? Boolean(config.openAiApiKey) : Boolean(config.geminiApiKey);

    const learnerTurn = {
      role: "learner",
      text: message,
      createdAt: new Date().toISOString()
    };

    let tutorReply = "";
    let tutorTranslation: string | null = null;
    let liveModelCall = false;

    try {
      const providerResult = await generateScenarioTutorReply({
        provider,
        tutorName: tutorVoice.name || "Dana",
        tutorSubtitle: tutorVoice.subtitle || "",
        themeTitle: theme.title || "Scenario",
        themeId: theme.id || "supermarket",
        situation: session.variation?.situation || "",
        level: session.learnerProfile?.level || null,
        goal: session.learnerProfile?.goal || null,
        native,
        starterLine: session.conversation?.starterLine || "",
        priorTurns: Array.isArray(session.turns) ? session.turns : [],
        learnerMessage: message
      });

      tutorReply = providerResult.text;
      tutorTranslation = providerResult.translation || null;
      liveModelCall = providerResult.liveModelCall;
    } catch {
      const fallbackReply = buildMockTutorReplyPayload({
        tutorName: tutorVoice.name || "Dana",
        themeId: theme.id || "supermarket",
        learnerMessage: message,
        provider
      });
      tutorReply = fallbackReply.text;
      tutorTranslation = fallbackReply.translation;
      liveModelCall = false;
    }

    const tutorTurn = {
      role: "tutor",
      text: tutorReply,
      translation: tutorTranslation,
      createdAt: new Date().toISOString(),
      provider,
      model,
      liveModelCall
    };

    await sessionRef.set(
      {
        turns: FieldValue.arrayUnion(learnerTurn, tutorTurn),
        updatedAt: FieldValue.serverTimestamp(),
        lastLearnerMessage: message,
        lastTutorReply: tutorReply
      },
      { merge: true }
    );

    res.status(200).json({
      status: true,
      message: "Scenario message processed successfully.",
      details: {
        sessionId,
        provider,
        providerConfigured,
        model,
        learnerTurn,
        tutorTurn
      }
    });
  })
);

/**
 * @openapi
 * /scenarios/sessions/{sessionId}/voice:
 *   post:
 *     tags:
 *       - Scenarios
 *     summary: Add a learner voice turn to a scenario session and get pronunciation scoring plus a tutor reply
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               audioBase64:
 *                 type: string
 *               mimeType:
 *                 type: string
 *                 example: audio/mp4
 *               fileName:
 *                 type: string
 *                 example: learner.m4a
 *               referenceText:
 *                 type: string
 *                 example: Ani mevakesh beitzim bevakasha.
 *     responses:
 *       200:
 *         description: Scenario voice response
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Missing or invalid Firebase token
 *       404:
 *         description: Scenario session not found
 */
router.post(
  "/sessions/:sessionId/voice/transcribe",
  authenticateFirebaseUser,
  asyncHandler(async (req, res) => {
    if (!req.firebaseUser) {
      throw new AppError(401, "UNAUTHENTICATED", "Authenticated user was not attached to the request.");
    }

    const { snapshot: userSnapshot } = await ensureUserDocument(req.firebaseUser);
    const sessionId = getRequiredParam(req.params.sessionId, "sessionId");
    const body = (req.body ?? {}) as ScenarioVoiceBody;
    const audioBase64 = typeof body.audioBase64 === "string" ? body.audioBase64.trim() : "";
    const mimeType = typeof body.mimeType === "string" && body.mimeType.trim() ? body.mimeType.trim() : "audio/mp4";
    const fileName = typeof body.fileName === "string" && body.fileName.trim() ? body.fileName.trim() : "learner-audio.m4a";
    const referenceText = typeof body.referenceText === "string" ? body.referenceText.trim() : "";

    if (!audioBase64) {
      throw new AppError(400, "MISSING_SCENARIO_AUDIO", "Scenario voice request requires a non-empty audioBase64 field.");
    }

    const { snapshot } = await getOwnedSession(req.firebaseUser.uid, sessionId);
    const session = snapshot.data() || {};
    const native = getCurrentNativeLanguage(userSnapshot.data(), session);
    const provider = session.provider === "openai" ? "openai" : "gemini";
    const tutorVoice = session.tutorVoice || { name: "Dana", subtitle: "Warm, patient, direct." };
    const theme = session.theme || { id: "supermarket", title: "Scenario" };

    const transcriptResult = await transcribeScenarioVoice({
      provider,
      tutorName: tutorVoice.name || "Dana",
      tutorSubtitle: tutorVoice.subtitle || "",
      themeTitle: theme.title || "Scenario",
      themeId: theme.id || "supermarket",
      situation: session.variation?.situation || "",
      level: session.learnerProfile?.level || null,
      goal: session.learnerProfile?.goal || null,
      native,
      starterLine: session.conversation?.starterLine || "",
      priorTurns: Array.isArray(session.turns) ? session.turns : [],
      learnerMessage: "",
      audioBase64,
      mimeType,
      fileName,
      referenceText
    });

    res.status(200).json({
      status: true,
      message: "Scenario voice transcribed successfully.",
      details: {
        sessionId,
        transcript: transcriptResult.transcript,
        learnerTurn: {
          role: "learner",
          text: transcriptResult.transcript,
          createdAt: new Date().toISOString(),
          inputMode: "voice"
        }
      }
    });
  })
);

router.post(
  "/sessions/:sessionId/voice/respond",
  authenticateFirebaseUser,
  asyncHandler(async (req, res) => {
    if (!req.firebaseUser) {
      throw new AppError(401, "UNAUTHENTICATED", "Authenticated user was not attached to the request.");
    }

    const { snapshot: userSnapshot } = await ensureUserDocument(req.firebaseUser);
    const sessionId = getRequiredParam(req.params.sessionId, "sessionId");
    const body = (req.body ?? {}) as ScenarioVoiceRespondBody;
    const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
    const referenceText = typeof body.referenceText === "string" ? body.referenceText.trim() : "";

    if (!transcript) {
      throw new AppError(400, "MISSING_SCENARIO_TRANSCRIPT", "Scenario voice response requires a non-empty transcript field.");
    }

    if (!isHebrewOnlyInput(transcript)) {
      throw new AppError(400, "SCENARIO_TRANSCRIPT_MUST_BE_HEBREW", "Scenario learner speech must resolve to Hebrew only.");
    }

    const { sessionRef, snapshot } = await getOwnedSession(req.firebaseUser.uid, sessionId);
    const session = snapshot.data() || {};
    const native = getCurrentNativeLanguage(userSnapshot.data(), session);
    const provider = session.provider === "openai" ? "openai" : "gemini";
    const tutorVoice = session.tutorVoice || { name: "Dana", subtitle: "Warm, patient, direct." };
    const theme = session.theme || { id: "supermarket", title: "Scenario" };
    const model = provider === "openai" ? config.openAiTranscriptionModel : config.geminiAudioModel;
    const providerConfigured = provider === "openai" ? Boolean(config.openAiApiKey) : Boolean(config.geminiApiKey);

    let pronunciation;
    let tutorReply;

    try {
      const result = await generateScenarioVoiceReplyFromTranscript({
        provider,
        tutorName: tutorVoice.name || "Dana",
        tutorSubtitle: tutorVoice.subtitle || "",
        themeTitle: theme.title || "Scenario",
        themeId: theme.id || "supermarket",
        situation: session.variation?.situation || "",
        level: session.learnerProfile?.level || null,
        goal: session.learnerProfile?.goal || null,
        native,
        starterLine: session.conversation?.starterLine || "",
        priorTurns: Array.isArray(session.turns) ? session.turns : [],
        referenceText,
        transcript
      });
      pronunciation = result.pronunciation;
      tutorReply = result.tutorReply;
    } catch {
      pronunciation = {
        overallScore: 75,
        accuracyScore: 74,
        fluencyScore: 77,
        feedback: "Keep the phrase shorter and repeat the target sound more clearly.",
        scoringMode: "transcript" as const,
        issues: [
          {
            label: "TZADI",
            issueCount: 1,
            severity: "medium" as const,
            affectedWord: "ביצים",
            expectedSound: "ts",
            heardApproximation: "s",
            hint: "Keep the tzadi as one crisp ts sound."
          }
        ]
      };
      tutorReply = {
        ...buildMockTutorReplyPayload({
          tutorName: tutorVoice.name || "Dana",
          themeId: theme.id || "supermarket",
          learnerMessage: transcript,
          provider
        }),
        provider,
        model,
        liveModelCall: false
      };
    }

    const learnerTurn = {
      role: "learner",
      text: transcript,
      createdAt: new Date().toISOString(),
      inputMode: "voice",
      pronunciation
    };

    const tutorTurn = {
      role: "tutor",
      text: tutorReply.text,
      translation: tutorReply.translation || null,
      createdAt: new Date().toISOString(),
      provider,
      model: tutorReply.model || model,
      liveModelCall: tutorReply.liveModelCall
    };

    await sessionRef.set(
      {
        turns: FieldValue.arrayUnion(learnerTurn, tutorTurn),
        updatedAt: FieldValue.serverTimestamp(),
        lastLearnerMessage: transcript,
        lastTutorReply: tutorReply.text,
        lastPronunciation: pronunciation
      },
      { merge: true }
    );

    res.status(200).json({
      status: true,
      message: "Scenario voice response generated successfully.",
      details: {
        sessionId,
        provider,
        providerConfigured,
        model: tutorTurn.model,
        transcript,
        pronunciation,
        learnerTurn,
        tutorTurn
      }
    });
  })
);

router.post(
  "/sessions/:sessionId/voice",
  authenticateFirebaseUser,
  asyncHandler(async (req, res) => {
    if (!req.firebaseUser) {
      throw new AppError(401, "UNAUTHENTICATED", "Authenticated user was not attached to the request.");
    }

    const { snapshot: userSnapshot } = await ensureUserDocument(req.firebaseUser);
    const sessionId = getRequiredParam(req.params.sessionId, "sessionId");
    const body = (req.body ?? {}) as ScenarioVoiceBody;
    const audioBase64 = typeof body.audioBase64 === "string" ? body.audioBase64.trim() : "";
    const mimeType = typeof body.mimeType === "string" && body.mimeType.trim() ? body.mimeType.trim() : "audio/mp4";
    const fileName = typeof body.fileName === "string" && body.fileName.trim() ? body.fileName.trim() : "learner-audio.m4a";
    const referenceText = typeof body.referenceText === "string" ? body.referenceText.trim() : "";

    if (!audioBase64) {
      throw new AppError(400, "MISSING_SCENARIO_AUDIO", "Scenario voice request requires a non-empty audioBase64 field.");
    }

    const { sessionRef, snapshot } = await getOwnedSession(req.firebaseUser.uid, sessionId);
    const session = snapshot.data() || {};
    const native = getCurrentNativeLanguage(userSnapshot.data(), session);
    const provider = session.provider === "openai" ? "openai" : "gemini";
    const tutorVoice = session.tutorVoice || { name: "Dana", subtitle: "Warm, patient, direct." };
    const theme = session.theme || { id: "supermarket", title: "Scenario" };
    const model = provider === "openai" ? config.openAiTranscriptionModel : config.geminiAudioModel;
    const providerConfigured = provider === "openai" ? Boolean(config.openAiApiKey) : Boolean(config.geminiApiKey);

    const voiceResult = await generateScenarioVoiceReply({
      provider,
      tutorName: tutorVoice.name || "Dana",
      tutorSubtitle: tutorVoice.subtitle || "",
      themeTitle: theme.title || "Scenario",
      themeId: theme.id || "supermarket",
      situation: session.variation?.situation || "",
      level: session.learnerProfile?.level || null,
      goal: session.learnerProfile?.goal || null,
      native,
      starterLine: session.conversation?.starterLine || "",
      priorTurns: Array.isArray(session.turns) ? session.turns : [],
      learnerMessage: "",
      audioBase64,
      mimeType,
      fileName,
      referenceText
    });

    const learnerTurn = {
      role: "learner",
      text: voiceResult.transcript,
      createdAt: new Date().toISOString(),
      inputMode: "voice",
      pronunciation: voiceResult.pronunciation
    };

    const tutorTurn = {
      role: "tutor",
      text: voiceResult.tutorReply.text,
      translation: voiceResult.tutorReply.translation || null,
      createdAt: new Date().toISOString(),
      provider,
      model: voiceResult.tutorReply.model,
      liveModelCall: voiceResult.tutorReply.liveModelCall
    };

    await sessionRef.set(
      {
        turns: FieldValue.arrayUnion(learnerTurn, tutorTurn),
        updatedAt: FieldValue.serverTimestamp(),
        lastLearnerMessage: voiceResult.transcript,
        lastTutorReply: voiceResult.tutorReply.text,
        lastPronunciation: voiceResult.pronunciation
      },
      { merge: true }
    );

    res.status(200).json({
      status: true,
      message: "Scenario voice processed successfully.",
      details: {
        sessionId,
        provider,
        providerConfigured,
        model,
        transcript: voiceResult.transcript,
        pronunciation: voiceResult.pronunciation,
        learnerTurn,
        tutorTurn
      }
    });
  })
);

/**
 * @openapi
 * /scenarios/roadmap:
 *   get:
 *     tags:
 *       - Scenarios
 *     summary: Retrieve the personalized learning roadmap for the authenticated user
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Personalized roadmap stops returned
 *       401:
 *         description: Missing or invalid Firebase token
 */
router.get(
  "/roadmap",
  authenticateFirebaseUser,
  asyncHandler(async (req, res) => {
    if (!req.firebaseUser) {
      throw new AppError(401, "UNAUTHENTICATED", "Authenticated user was not attached to the request.");
    }

    const { snapshot: userSnapshot } = await ensureUserDocument(req.firebaseUser);
    const userData = userSnapshot.data() || {};
    
    const completedStops = Array.isArray(userData.completedStops) 
      ? userData.completedStops 
      : [];

    const template = [
      { id: "s1", title: "Falafel Stand", he: "דּוּכַן פָּלָאפֶל", fmt: "Roleplay" },
      { id: "s2", title: "Greeting a Neighbor", he: "שָׁכֵן", fmt: "Roleplay" },
      { id: "s3", title: "Numbers, 1–20", he: "מִסְפָּרִים", fmt: "Drill" },
      { id: "cp1", title: "Checkpoint", he: "מִבְחָן", fmt: "Pick a format", isCheckpoint: true },
      { id: "s4", title: "At the Supermarket", he: "בַּסּוּפֶּר", fmt: "Roleplay" },
      { id: "s5", title: "Asking for Help", he: "מְבַקֵּשׁ עֶזְרָה", fmt: "Roleplay" },
      { id: "s6", title: "Café Order", he: "בְּבֵית קָפֶה", fmt: "Roleplay" },
      { id: "tl1", title: "Past Tense, men.", he: "עָבָר", fmt: "Tutor" },
      { id: "cp2", title: "Checkpoint", he: "מִבְחָן", fmt: "Pick a format", isCheckpoint: true }
    ];

    let foundCurrent = false;

    const stops = template.map((item) => {
      if (item.isCheckpoint) {
        return {
          id: item.id,
          kind: "checkpoint",
          title: item.title,
          he: item.he,
          fmt: item.fmt
        };
      }

      if (completedStops.includes(item.id)) {
        return {
          id: item.id,
          kind: "done",
          title: item.title,
          he: item.he,
          fmt: item.fmt
        };
      }

      if (!foundCurrent) {
        foundCurrent = true;
        return {
          id: item.id,
          kind: "current",
          title: item.title,
          he: item.he,
          fmt: item.fmt
        };
      }

      return {
        id: item.id,
        kind: "locked",
        title: item.title,
        he: item.he,
        fmt: item.fmt
      };
    });

    res.status(200).json({
      status: true,
      message: "Personalized roadmap fetched successfully.",
      details: {
        completedStops,
        stops
      }
    });
  })
);

/**
 * @openapi
 * /scenarios/roadmap/complete:
 *   post:
 *     tags:
 *       - Scenarios
 *     summary: Mark a roadmap stop as completed
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               stopId:
 *                 type: string
 *                 example: s4
 *     responses:
 *       200:
 *         description: Roadmap stop marked as completed successfully
 *       400:
 *         description: Invalid or missing stopId
 *       401:
 *         description: Missing or invalid Firebase token
 */
router.post(
  "/roadmap/complete",
  authenticateFirebaseUser,
  asyncHandler(async (req, res) => {
    if (!req.firebaseUser) {
      throw new AppError(401, "UNAUTHENTICATED", "Authenticated user was not attached to the request.");
    }

    const { ref: userRef } = await ensureUserDocument(req.firebaseUser);
    const { stopId } = req.body ?? {};

    if (typeof stopId !== "string" || !stopId.trim()) {
      throw new AppError(400, "MISSING_STOP_ID", "Completing a stop requires a non-empty stopId.");
    }

    await userRef.update({
      completedStops: FieldValue.arrayUnion(stopId.trim())
    });

    res.status(200).json({
      status: true,
      message: `Roadmap stop '${stopId}' completed successfully.`
    });
  })
);

export default router;
