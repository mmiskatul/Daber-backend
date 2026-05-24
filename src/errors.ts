export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function toErrorResponse(error: unknown): {
  statusCode: number;
  body: { status: false; message: string; details?: unknown };
} {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      body: {
        status: false,
        message: error.message,
        details: {
          code: error.code,
          cause: error.details ?? null
        }
      }
    };
  }

  if (error instanceof Error) {
    return {
      statusCode: 500,
      body: {
        status: false,
        message: "Unexpected server error.",
        details: {
          code: "INTERNAL_SERVER_ERROR",
          cause: error.message
        }
      }
    };
  }

  return {
    statusCode: 500,
    body: {
      status: false,
      message: "Unexpected server error.",
      details: {
        code: "INTERNAL_SERVER_ERROR",
        cause: null
      }
    }
  };
}
