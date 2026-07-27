import type { Response } from "express";
import type { ZodError, ZodType } from "zod";

// Fejlsvar har altid samme form, så klienten kan vise feltspecifikke fejl uden
// at gætte. Brugerens input bevares i UI'et — serveren sender det ikke retur.
export type ApiError = {
  error: {
    message: string;
    fields?: Record<string, string>;
  };
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new HttpError(400, message, fields);
export const unauthorized = (message = "Du er ikke logget ind.") =>
  new HttpError(401, message);
export const forbidden = (message = "Du har ikke adgang til det her.") =>
  new HttpError(403, message);
export const notFound = (message = "Blev ikke fundet.") =>
  new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);

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
    throw badRequest("Nogle felter er ikke udfyldt rigtigt.", fieldErrors(result.error));
  }
  return result.data;
}

export function sendError(res: Response, error: HttpError): void {
  const body: ApiError = {
    error: { message: error.message, ...(error.fields ? { fields: error.fields } : {}) },
  };
  res.status(error.status).json(body);
}
