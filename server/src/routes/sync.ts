import { Router } from "express";
import { pullRequestSchema, pushRequestSchema } from "@spil/shared";
import { parseOrThrow } from "../http.js";
import { requireUser } from "../session.js";
import { pull, push } from "../sync.js";

export const syncRouter: Router = Router();

syncRouter.use(requireUser);

syncRouter.post("/pull", (req, res) => {
  const { since } = parseOrThrow(pullRequestSchema, req.body ?? {});
  res.json(pull(req.user!.id, since));
});

syncRouter.post("/push", (req, res) => {
  const { mutations } = parseOrThrow(pushRequestSchema, req.body ?? {});
  res.json(push(req.user!.id, mutations));
});
