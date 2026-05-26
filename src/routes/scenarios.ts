import { randomUUID } from "crypto";
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
import { generateScenarioTutorReply, generateScenarioVoiceReply } from "../scenarioProviders";

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
  const trimmed = input.learnerMessage.trim();

  if (input.themeId === "supermarket") {
    return `${input.tutorName}: Got it. In the supermarket, a natural next step is to ask where the item is or how much it costs. You said: "${trimmed}".`;
  }

  if (input.themeId === "shuk") {
    return `${input.tutorName}: In the Friday market, keep it short and direct. You can ask about price, freshness, or quantity. You said: "${trimmed}".`;
  }

  if (input.themeId === "cafe") {
    return `${input.tutorName}: In the café, that works. A useful follow-up is your drink size or whether you want it to stay or go. You said: "${trimmed}".`;
  }

  return `${input.tutorName}: I heard "${trimmed}". Let's keep building the conversation naturally.`;
}

function getRequiredParam(value: string | string[] | undefined, name: string): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  throw new AppError(400, "MISSING_ROUTE_PARAM", `Missing required route parameter: ${name}.`);
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

    await ensureUserDocument(req.firebaseUser);

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
  "/sessions/:sessionId/message",
  authenticateFirebaseUser,
  asyncHandler(async (req, res) => {
    if (!req.firebaseUser) {
      throw new AppError(401, "UNAUTHENTICATED", "Authenticated user was not attached to the request.");
    }

    await ensureUserDocument(req.firebaseUser);
    const sessionId = getRequiredParam(req.params.sessionId, "sessionId");
    const body = (req.body ?? {}) as ScenarioMessageBody;
    const message = typeof body.message === "string" ? body.message.trim() : "";

    if (!message) {
      throw new AppError(400, "MISSING_SCENARIO_MESSAGE", "Scenario message requires a non-empty message field.");
    }

    const { sessionRef, snapshot } = await getOwnedSession(req.firebaseUser.uid, sessionId);
    const session = snapshot.data() || {};
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
        native: session.learnerProfile?.native || null,
        starterLine: session.conversation?.starterLine || "",
        priorTurns: Array.isArray(session.turns) ? session.turns : [],
        learnerMessage: message
      });

      tutorReply = providerResult.text;
      liveModelCall = providerResult.liveModelCall;
    } catch {
      tutorReply = buildMockTutorReply({
        tutorName: tutorVoice.name || "Dana",
        themeId: theme.id || "supermarket",
        learnerMessage: message,
        provider
      });
      liveModelCall = false;
    }

    const tutorTurn = {
      role: "tutor",
      text: tutorReply,
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
  "/sessions/:sessionId/voice",
  authenticateFirebaseUser,
  asyncHandler(async (req, res) => {
    if (!req.firebaseUser) {
      throw new AppError(401, "UNAUTHENTICATED", "Authenticated user was not attached to the request.");
    }

    await ensureUserDocument(req.firebaseUser);
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
      native: session.learnerProfile?.native || null,
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

export default router;
