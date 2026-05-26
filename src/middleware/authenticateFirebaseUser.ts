import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors";
import { verifyJwt } from "../jwt";
import { config } from "../config";

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

    try {
      const decoded = verifyJwt(token, config.jwtAccessSecret);
      req.firebaseUser = decoded;
      next();
    } catch (jwtError) {
      const msg = jwtError instanceof Error ? jwtError.message : "Token verification failed.";
      if (msg === "Token expired.") {
        throw new AppError(401, "ACCESS_TOKEN_EXPIRED", "Access token has expired.", msg);
      } else {
        throw new AppError(401, "INVALID_ACCESS_TOKEN", "Invalid backend access token.", msg);
      }
    }
  } catch (error) {
    next(error);
  }
}
