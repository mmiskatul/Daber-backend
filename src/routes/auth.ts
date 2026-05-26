import { Router } from "express";
import { AppError } from "../errors";
import { asyncHandler } from "../middleware/asyncHandler";
import { authenticateFirebaseUser } from "../middleware/authenticateFirebaseUser";
import admin from "../firebaseAdmin";
import { ensureUserDocument } from "../userProfile";

const router = Router();
const db = admin.firestore();

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

    try {
      const result = await ensureUserDocument(req.firebaseUser, req.body);

      res.status(200).json({
        status: true,
        message: "User synced successfully.",
        details: {
          uid: req.firebaseUser.uid,
          isNewUser: result.isNewUser
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
      const { snapshot, isNewUser } = await ensureUserDocument(req.firebaseUser);

      res.status(200).json({
        status: true,
        message: "User profile fetched successfully.",
        details: {
          ...snapshot.data(),
          isNewUser
        }
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
