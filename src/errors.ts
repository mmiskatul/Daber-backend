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

  if (error && typeof error === "object") {
    const errorObj = error as {
      statusCode?: unknown;
      status?: unknown;
      message?: unknown;
      type?: unknown;
      expose?: unknown;
    };
    const maybeStatusCode = errorObj.statusCode;
    const maybeStatus = errorObj.status;
    const numericStatusCode =
      typeof maybeStatusCode === "number" && Number.isFinite(maybeStatusCode)
        ? maybeStatusCode
        : typeof maybeStatus === "number" && Number.isFinite(maybeStatus)
          ? maybeStatus
          : null;

    if (numericStatusCode) {
      const message = typeof errorObj.message === "string" && errorObj.message.trim() ? errorObj.message.trim() : "Request failed.";
      const code = typeof errorObj.type === "string" ? errorObj.type : "HTTP_ERROR";
      const cause = typeof errorObj.expose === "boolean" && errorObj.expose ? message : null;

      return {
        statusCode: numericStatusCode,
        body: {
          status: false,
          message,
          details: {
            code,
            cause
          }
        }
      };
    }
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
