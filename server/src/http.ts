import type { Response } from "express";
import type { ZodError, ZodType } from "zod";
import { errorText, type ErrorCode } from "@spil/shared";

// Fejlsvar har altid samme form, så klienten kan vise feltspecifikke fejl uden
// at gætte. Brugerens input bevares i UI'et — serveren sender det ikke retur.
export type ApiError = {
  error: {
    /** Stabil kode. Klienten oversætter den til brugerens sprog. */
    code: ErrorCode;
    /** Læsbar tekst, så et rå API-kald stadig giver mening. Fallback i klienten. */
    message: string;
    /** Feltnavn → fejlkode. */
    fields?: Record<string, string>;
  };
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    /** Overskriver fallback-teksten. Bruges når serveren har noget ekstra at sige. */
    message?: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message ?? errorText(code));
    this.name = "HttpError";
  }
}

export const badRequest = (code: ErrorCode, fields?: Record<string, string>) =>
  new HttpError(400, code, undefined, fields);
export const unauthorized = () => new HttpError(401, "unauthorized");
export const forbidden = (code: ErrorCode = "forbidden") => new HttpError(403, code);
export const notFound = (code: ErrorCode = "not_found") => new HttpError(404, code);

export function fieldErrors(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  return fields;
}

// zod safeParse på alt input. Ved fejl: 400 med feltspecifikke fejl.
export function parseOrThrow<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw badRequest("validation", fieldErrors(result.error));
  }
  return result.data;
}

export function sendError(res: Response, error: HttpError): void {
  const body: ApiError = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.fields ? { fields: error.fields } : {}),
    },
  };
  res.status(error.status).json(body);
}
