import type { NextFunction, Request, Response } from "express";
import admin from "../firebaseAdmin";
import { AppError } from "../errors";

export async function authenticateFirebaseUser(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const header = req.headers.authorization ?? "";

    if (!header.startsWith("Bearer ")) {
      throw new AppError(401, "MISSING_BEARER_TOKEN", "Missing Bearer token.");
    }

    const token = header.slice("Bearer ".length).trim();

    if (!token) {
      throw new AppError(401, "EMPTY_BEARER_TOKEN", "Empty Bearer token.");
    }

    req.firebaseUser = await admin.auth().verifyIdToken(token);
    next();
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
      return;
    }

    const message = error instanceof Error ? error.message : "Token verification failed.";
    next(new AppError(401, "INVALID_FIREBASE_ID_TOKEN", "Invalid Firebase ID token.", message));
  }
}
