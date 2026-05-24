import type { NextFunction, Request, Response } from "express";
import { toErrorResponse } from "../errors";

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  const response = toErrorResponse(error);
  res.status(response.statusCode).json(response.body);
}
