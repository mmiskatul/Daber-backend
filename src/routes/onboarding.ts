import { Router } from "express";
import { FieldValue } from "firebase-admin/firestore";
import { AppError } from "../errors";
import { asyncHandler } from "../middleware/asyncHandler";
import { authenticateFirebaseUser } from "../middleware/authenticateFirebaseUser";
import { ensureUserDocument, normalizeString } from "../userProfile";

type OnboardingBody = {
  native?: string;
  level?: string;
  goal?: string;
  voice?: string;
};

type OnboardingLanguageBody = {
  native?: string;
};

type OnboardingData = {
  native: string;
  level: string;
  goal: string;
  voice: string;
};

const NATIVE_ALIASES: Record<string, string> = {
  English: "English",
  Spanish: "Spanish",
  "EspaÃƒÂ±ol": "Spanish",
  "EspaÃ±ol": "Spanish",
  French: "French",
  "FranÃƒÂ§ais": "French",
  "FranÃ§ais": "French",
  Russian: "Russian",
  "ÃÂ Ã‘Æ’Ã‘ÂÃ‘ÂÃÂºÃÂ¸ÃÂ¹": "Russian",
  "Ð ÑƒÑÑÐºÐ¸Ð¹": "Russian",
  Other: "Other"
};

const ALLOWED_NATIVE = new Set(["English", "Spanish", "French", "Russian", "Other"]);
const ALLOWED_LEVEL = new Set(["A1", "A2", "B1", "B2", "C1"]);
const ALLOWED_GOAL = new Set(["travel", "family", "work", "culture"]);
const ALLOWED_VOICE = new Set(["dana", "noam", "shira"]);

const router = Router();

function ensureAllowed(value: string | null, allowed: Set<string>, field: string): string {
  if (!value || !allowed.has(value)) {
    throw new AppError(400, "INVALID_ONBOARDING_FIELD", `Invalid onboarding value for ${field}.`, {
      field,
      value
    });
  }

  return value;
}

function normalizeNativeLanguage(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return NATIVE_ALIASES[value] || value;
}

function parseOnboardingBody(body: unknown): OnboardingData {
  const payload = (body ?? {}) as OnboardingBody;

  return {
    native: ensureAllowed(normalizeNativeLanguage(normalizeString(payload.native)), ALLOWED_NATIVE, "native"),
    level: ensureAllowed(normalizeString(payload.level), ALLOWED_LEVEL, "level"),
    goal: ensureAllowed(normalizeString(payload.goal), ALLOWED_GOAL, "goal"),
    voice: ensureAllowed(normalizeString(payload.voice), ALLOWED_VOICE, "voice")
  };
}

/**
 * @openapi
 * /onboarding:
 *   get:
 *     tags:
 *       - Onboarding
 *     summary: Get the current authenticated user's onboarding data
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Onboarding data fetched
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OnboardingResponse'
 *       401:
 *         description: Missing or invalid Firebase token
 *       404:
 *         description: Onboarding data not found
 */
router.get(
  "/",
  authenticateFirebaseUser,
  asyncHandler(async (req, res) => {
    if (!req.firebaseUser) {
      throw new AppError(401, "UNAUTHENTICATED", "Authenticated user was not attached to the request.");
    }

    const { snapshot } = await ensureUserDocument(req.firebaseUser);
    const data = snapshot.data();

    if (!data?.onboarding) {
      throw new AppError(404, "ONBOARDING_NOT_FOUND", "Onboarding data not found.");
    }

    res.status(200).json({
      status: true,
      message: "Onboarding data fetched successfully.",
      details: data.onboarding
    });
  })
);

/**
 * @openapi
 * /onboarding:
 *   post:
 *     tags:
 *       - Onboarding
 *     summary: Save the current authenticated user's onboarding answers
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OnboardingRequest'
 *     responses:
 *       200:
 *         description: Onboarding saved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OnboardingResponse'
 *       400:
 *         description: Invalid onboarding payload
 *       401:
 *         description: Missing or invalid Firebase token
 */
router.post(
  "/",
  authenticateFirebaseUser,
  asyncHandler(async (req, res) => {
    if (!req.firebaseUser) {
      throw new AppError(401, "UNAUTHENTICATED", "Authenticated user was not attached to the request.");
    }

    const onboarding = parseOnboardingBody(req.body);
    const { ref: userRef, isNewUser } = await ensureUserDocument(req.firebaseUser);

    await userRef.set(
      {
        onboarding,
        onboardingCompleted: true,
        onboardingCompletedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    res.status(200).json({
      status: true,
      message: "Onboarding saved successfully.",
      details: {
        ...onboarding,
        isNewUser
      }
    });
  })
);

router.patch(
  "/language",
  authenticateFirebaseUser,
  asyncHandler(async (req, res) => {
    if (!req.firebaseUser) {
      throw new AppError(401, "UNAUTHENTICATED", "Authenticated user was not attached to the request.");
    }

    const payload = (req.body ?? {}) as OnboardingLanguageBody;
    const native = ensureAllowed(normalizeNativeLanguage(normalizeString(payload.native)), ALLOWED_NATIVE, "native");
    const { ref: userRef, snapshot } = await ensureUserDocument(req.firebaseUser);
    const current = snapshot.data()?.onboarding || {};

    await userRef.set(
      {
        onboarding: {
          ...current,
          native
        },
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    const sessions = await userRef.collection("scenarioSessions").get();
    const batch = userRef.firestore.batch();

    sessions.docs.forEach((doc) => {
      batch.set(
        doc.ref,
        {
          learnerProfile: {
            ...(doc.data().learnerProfile || {}),
            native
          },
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    });

    if (!sessions.empty) {
      await batch.commit();
    }

    res.status(200).json({
      status: true,
      message: "Support language updated successfully.",
      details: {
        native
      }
    });
  })
);

export default router;
