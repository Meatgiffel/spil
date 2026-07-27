import { Router, type Express, type Response } from "express";
import { toNodeHandler } from "better-auth/node";
import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { setupSchema, signUpSchema } from "@spil/shared";
import { auth } from "../auth.js";
import { db } from "../db/client.js";
import { player, user as userTable } from "../db/schema.js";
import { badRequest, HttpError, parseOrThrow } from "../http.js";
import {
  consumeInviteKey,
  needsSetup,
  recordInviteKeyUse,
  refundInviteKey,
} from "../invites.js";
import { allocateServerSeq } from "../sync.js";

/**
 * Better Auths egne ruter. Skal monteres *før* express.json(), fordi handleren
 * læser den rå body selv.
 *
 * Sign-up blokeres her: den eneste vej til en konto er POST /api/signup, som
 * håndhæver invitationsnøglen. Uden blokeringen ville nøglekravet kunne omgås
 * ved at kalde Better Auth direkte.
 */
export function mountBetterAuth(app: Express): void {
  app.all("/api/auth/sign-up{/*rest}", (_req, _res, next) => {
    next(
      new HttpError(
        400,
        "invite_key_missing",
        "Konti oprettes via /api/signup, hvor invitationsnøglen kontrolleres.",
      ),
    );
  });
  app.all("/api/auth/*splat", toNodeHandler(auth));
}

async function pipeAuthResponse(res: Response, response: Response_): Promise<unknown> {
  for (const cookie of response.headers.getSetCookie()) {
    res.append("Set-Cookie", cookie);
  }
  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : null;
  res.status(response.status).json(body);
  return body;
}

// Alias, så typen ikke forveksles med Express' egen Response.
type Response_ = globalThis.Response;

export const authRouter: Router = Router();

// Frontenden bruger den til at afgøre om den skal vise førstegangsopsætning
// eller det almindelige login.
authRouter.get("/auth-status", (_req, res) => {
  res.json({ needsSetup: needsSetup() });
});

authRouter.post("/signup", async (req, res, next) => {
  try {
    const setup = needsSetup();
    // Første bruger i en tom installation bliver admin og skal ikke bruge nøgle.
    const input = setup
      ? { ...parseOrThrow(setupSchema, req.body), inviteKey: null }
      : parseOrThrow(signUpSchema, req.body);

    const email = input.email.trim().toLowerCase();

    // Tjekkes før nøglen forbruges, så den mest almindelige fejl ikke brænder en nøgle.
    const existing = db
      .select({ id: userTable.id })
      .from(userTable)
      .where(eq(userTable.email, email))
      .get();
    if (existing) {
      throw badRequest("email_taken", { email: "email_taken" });
    }

    const inviteKeyId = input.inviteKey ? consumeInviteKey(input.inviteKey) : null;

    let response: Response_;
    try {
      response = await auth.api.signUpEmail({
        body: { email, password: input.password, name: input.name },
        asResponse: true,
      });
    } catch (error) {
      if (inviteKeyId) refundInviteKey(inviteKeyId);
      throw error;
    }

    if (!response.ok) {
      if (inviteKeyId) refundInviteKey(inviteKeyId);
      await pipeAuthResponse(res, response);
      return;
    }

    const body = (await pipeAuthResponse(res, response)) as {
      user?: { id?: string };
    } | null;
    const userId = body?.user?.id;

    if (userId) {
      if (setup) {
        db.update(userTable)
          .set({ role: "admin" })
          .where(eq(userTable.id, userId))
          .run();
      }
      if (inviteKeyId) recordInviteKeyUse(inviteKeyId, userId);
      // Hver konto får en spiller, så brugeren straks kan tilføjes til grupper.
      // Partier refererer altid en spiller, aldrig en bruger.
      db.insert(player)
        .values({
          id: uuidv7(),
          userId,
          name: input.name,
          updatedAt: Date.now(),
          // Skrivningen sker uden om sync-push, så sekvensen skal tildeles her —
          // ellers ville spilleren aldrig blive hentet af nogen klient.
          serverSeq: allocateServerSeq(),
          deletedAt: null,
          updatedBy: userId,
        })
        .run();
    }
  } catch (error) {
    next(error instanceof HttpError ? error : error);
  }
});
