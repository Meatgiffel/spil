import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./auth.js";
import { forbidden, unauthorized } from "./http.js";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: string;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export async function readSessionUser(req: Request): Promise<SessionUser | null> {
  const result = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  if (!result?.user) return null;
  return {
    id: result.user.id,
    email: result.user.email,
    name: result.user.name,
    role: (result.user as { role?: string }).role ?? "user",
  };
}

export async function requireUser(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await readSessionUser(req);
    if (!user) {
      next(unauthorized());
      return;
    }
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

// Rollen styrer kun hvem der må udstede invitationsnøgler. Adgang til data
// afgøres altid af gruppemedlemskab, aldrig af rollen.
export function requireAdmin(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (req.user?.role !== "admin") {
    next(forbidden("admin_required"));
    return;
  }
  next();
}
