import { Router } from "express";
import { createInviteKeySchema } from "@spil/shared";
import { parseOrThrow } from "../http.js";
import { createInviteKey, listInviteKeys, revokeInviteKey } from "../invites.js";
import { requireAdmin, requireUser } from "../session.js";

// Monteres på /api/invites, så adgangstjekket kun rammer disse ruter og ikke
// alt andet under /api.
export const invitesRouter: Router = Router();

invitesRouter.use(requireUser, requireAdmin);

invitesRouter.get("/", (_req, res) => {
  res.json({ inviteKeys: listInviteKeys() });
});

invitesRouter.post("/", (req, res) => {
  const input = parseOrThrow(createInviteKeySchema, req.body ?? {});
  const created = createInviteKey(input, req.user!.id);
  // key sendes kun i dette ene svar — den kan aldrig hentes igen.
  res.status(201).json({ inviteKey: created });
});

invitesRouter.post("/:id/revoke", (req, res) => {
  revokeInviteKey(req.params.id);
  res.json({ status: "ok" });
});
