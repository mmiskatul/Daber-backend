import { Router } from "express";
import { FieldValue } from "firebase-admin/firestore";
import admin from "../firebaseAdmin";
import { AppError } from "../errors";
import { asyncHandler } from "../middleware/asyncHandler";
import { authenticateFirebaseUser } from "../middleware/authenticateFirebaseUser";

type SyncUserBody = {
  firstName?: string;
  lastName?: string;
  phone?: string;
  username?: string;
  avatarUrl?: string;
  displayName?: string;
  photoURL?: string;
};

type UserProfileFields = {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  username: string | null;
  avatarUrl: string | null;
};

const router = Router();
const db = admin.firestore();

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pickProfileFields(body: unknown): UserProfileFields {
  const payload = (body ?? {}) as SyncUserBody;

  return {
    firstName: normalizeString(payload.firstName),
    lastName: normalizeString(payload.lastName),
    phone: normalizeString(payload.phone),
    username: normalizeString(payload.username),
    avatarUrl: normalizeString(payload.avatarUrl)
  };
}

/**
 * @openapi
 * /auth/sync-user:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Verify Firebase token and create or update the user profile
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SyncUserRequest'
 *     responses:
 *       200:
 *         description: User synced
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SyncUserResponse'
 *       401:
 *         description: Missing or invalid Firebase token
 *       500:
 *         description: Failed to sync user
 */
router.post(
  "/sync-user",
  authenticateFirebaseUser,
  asyncHandler(async (req, res) => {
    if (!req.firebaseUser) {
      throw new AppError(401, "UNAUTHENTICATED", "Authenticated user was not attached to the request.");
    }

    const decoded = req.firebaseUser;
    const uid = decoded.uid;
    const body = (req.body ?? {}) as SyncUserBody;
    const profile = pickProfileFields(body);

    const userRef = db.collection("users").doc(uid);
    const now = FieldValue.serverTimestamp();

    const payload = {
      uid,
      email: decoded.email ?? null,
      emailVerified: Boolean(decoded.email_verified),
      displayName: decoded.name ?? normalizeString(body.displayName),
      photoURL: decoded.picture ?? normalizeString(body.photoURL),
      provider: decoded.firebase.sign_in_provider ?? null,
      lastLoginAt: now,
      ...profile
    };

    try {
      const snapshot = await userRef.get();

      if (!snapshot.exists) {
        await userRef.set({ ...payload, createdAt: now }, { merge: true });
      } else {
        await userRef.set(payload, { merge: true });
      }

      res.status(200).json({
        status: true,
        message: "User synced successfully.",
        details: {
          uid,
          isNewUser: !snapshot.exists
        }
      });
    } catch (error) {
      throw new AppError(
        500,
        "FIRESTORE_SYNC_FAILED",
        "Failed to sync user.",
        error instanceof Error ? error.message : error
      );
    }
  })
);

/**
 * @openapi
 * /auth/me:
 *   get:
 *     tags:
 *       - Auth
 *     summary: Get the current authenticated user's stored profile
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Stored user profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserProfileResponse'
 *       401:
 *         description: Missing or invalid Firebase token
 *       404:
 *         description: User not found in Firestore
 *       500:
 *         description: Failed to load user
 */
router.get(
  "/me",
  authenticateFirebaseUser,
  asyncHandler(async (req, res) => {
    if (!req.firebaseUser) {
      throw new AppError(401, "UNAUTHENTICATED", "Authenticated user was not attached to the request.");
    }

    try {
      const snapshot = await db.collection("users").doc(req.firebaseUser.uid).get();

      if (!snapshot.exists) {
        throw new AppError(404, "USER_NOT_FOUND", "User record not found.");
      }

      res.status(200).json({
        status: true,
        message: "User profile fetched successfully.",
        details: snapshot.data()
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        500,
        "FIRESTORE_READ_FAILED",
        "Failed to load user.",
        error instanceof Error ? error.message : error
      );
    }
  })
);

export default router;
