import { Router } from "express";
import { AppError } from "../errors";
import { asyncHandler } from "../middleware/asyncHandler";
import { authenticateFirebaseUser } from "../middleware/authenticateFirebaseUser";
import admin from "../firebaseAdmin";
import { ensureUserDocument } from "../userProfile";
import { signJwt, verifyJwt } from "../jwt";
import { config } from "../config";

const router = Router();
const db = admin.firestore();

/**
 * @openapi
 * /auth/sync-user:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Exchange a Firebase ID token for custom backend session tokens and sync user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - firebaseToken
 *             properties:
 *               firebaseToken:
 *                 type: string
 *               displayName:
 *                 type: string
 *               photoURL:
 *                 type: string
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               username:
 *                 type: string
 *     responses:
 *       200:
 *         description: User synced and tokens issued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 details:
 *                   type: object
 *                   properties:
 *                     uid:
 *                       type: string
 *                     isNewUser:
 *                       type: boolean
 *                     accessToken:
 *                       type: string
 *                     refreshToken:
 *                       type: string
 */
router.post(
  "/sync-user",
  asyncHandler(async (req, res) => {
    const { firebaseToken, ...body } = req.body ?? {};

    if (!firebaseToken) {
      throw new AppError(400, "MISSING_FIREBASE_TOKEN", "Firebase ID token is required in req.body.firebaseToken.");
    }

    let decodedFirebaseUser;
    try {
      decodedFirebaseUser = await admin.auth().verifyIdToken(firebaseToken);
    } catch (verifyError) {
      const msg = verifyError instanceof Error ? verifyError.message : "Firebase verification failed.";
      throw new AppError(401, "INVALID_FIREBASE_ID_TOKEN", "Invalid Firebase ID token.", msg);
    }

    try {
      const result = await ensureUserDocument(decodedFirebaseUser, body);

      // Generate short-lived Access Token (15 mins) and long-lived Refresh Token (30 days)
      const payload = {
        uid: decodedFirebaseUser.uid,
        email: decodedFirebaseUser.email ?? null,
        email_verified: Boolean(decodedFirebaseUser.email_verified),
        name: decodedFirebaseUser.name ?? body.displayName ?? null,
        picture: decodedFirebaseUser.picture ?? body.photoURL ?? null,
        firebase: {
          sign_in_provider: decodedFirebaseUser.firebase.sign_in_provider ?? null
        }
      };

      const accessToken = signJwt(payload, config.jwtAccessSecret, 900);
      const refreshToken = signJwt({ uid: decodedFirebaseUser.uid }, config.jwtRefreshSecret, 2592000);

      res.status(200).json({
        status: true,
        message: "User synced and backend tokens generated successfully.",
        details: {
          uid: decodedFirebaseUser.uid,
          isNewUser: result.isNewUser,
          accessToken,
          refreshToken
        }
      });
    } catch (error) {
      throw new AppError(
        500,
        "FIRESTORE_SYNC_FAILED",
        "Failed to sync user and generate tokens.",
        error instanceof Error ? error.message : error
      );
    }
  })
);

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Refresh custom backend access token using a refresh token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Fresh access token generated
 */
router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body ?? {};

    if (!refreshToken) {
      throw new AppError(400, "MISSING_REFRESH_TOKEN", "Refresh token is required.");
    }

    let decodedRefresh;
    try {
      decodedRefresh = verifyJwt(refreshToken, config.jwtRefreshSecret);
    } catch (jwtError) {
      const msg = jwtError instanceof Error ? jwtError.message : "Refresh token verification failed.";
      throw new AppError(401, "INVALID_REFRESH_TOKEN", "Invalid or expired refresh token.", msg);
    }

    try {
      const userRef = db.collection("users").doc(decodedRefresh.uid);
      const snapshot = await userRef.get();

      if (!snapshot.exists) {
        throw new AppError(404, "USER_NOT_FOUND", "User profile not found in database.");
      }

      const userData = snapshot.data() ?? {};

      // Reconstruct payload
      const payload = {
        uid: decodedRefresh.uid,
        email: userData.email ?? null,
        email_verified: Boolean(userData.emailVerified),
        name: userData.displayName ?? null,
        picture: userData.photoURL ?? null,
        firebase: {
          sign_in_provider: userData.provider ?? null
        }
      };

      const newAccessToken = signJwt(payload, config.jwtAccessSecret, 900);
      const newRefreshToken = signJwt({ uid: decodedRefresh.uid }, config.jwtRefreshSecret, 2592000);

      res.status(200).json({
        status: true,
        message: "Access token refreshed successfully.",
        details: {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken
        }
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        500,
        "TOKEN_REFRESH_FAILED",
        "Failed to generate new access token.",
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
