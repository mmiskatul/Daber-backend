import { Router } from "express";
import { FieldValue } from "firebase-admin/firestore";
import admin from "../firebaseAdmin";
import { AppError } from "../errors";
import { asyncHandler } from "../middleware/asyncHandler";
import { authenticateFirebaseUser } from "../middleware/authenticateFirebaseUser";

type OnboardingBody = {
  native?: string;
  level?: string;
  goal?: string;
  voice?: string;
};

type OnboardingData = {
  native: string;
  level: string;
  goal: string;
  voice: string;
};

const ALLOWED_NATIVE = new Set(["English", "Español", "Français", "Русский", "Other"]);
const ALLOWED_LEVEL = new Set(["A1", "A2", "B1", "B2", "C1"]);
const ALLOWED_GOAL = new Set(["travel", "family", "work", "culture"]);
const ALLOWED_VOICE = new Set(["dana", "noam", "shira"]);

const router = Router();
const db = admin.firestore();

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function ensureAllowed(value: string | null, allowed: Set<string>, field: string): string {
  if (!value || !allowed.has(value)) {
    throw new AppError(400, "INVALID_ONBOARDING_FIELD", `Invalid onboarding value for ${field}.`, {
      field,
      value
    });
  }

  return value;
}

function parseOnboardingBody(body: unknown): OnboardingData {
  const payload = (body ?? {}) as OnboardingBody;

  return {
    native: ensureAllowed(normalizeString(payload.native), ALLOWED_NATIVE, "native"),
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

    const snapshot = await db.collection("users").doc(req.firebaseUser.uid).get();

    if (!snapshot.exists) {
      throw new AppError(404, "USER_NOT_FOUND", "User record not found.");
    }

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
    const userRef = db.collection("users").doc(req.firebaseUser.uid);

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
      details: onboarding
    });
  })
);

export default router;
