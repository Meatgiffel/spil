import express, { type NextFunction, type Request, type Response } from "express";
import { env, isProduction } from "./env.js";
import { HttpError, sendError } from "./http.js";
import { authRouter, mountBetterAuth } from "./routes/auth.js";
import { gamesRouter } from "./routes/games.js";
import { invitesRouter } from "./routes/invites.js";
import { syncRouter } from "./routes/sync.js";
import { uploadsRouter } from "./routes/uploads.js";

export const app = express();

// Bag nginx i containeren og nginxproxymanager udenfor. Uden det her ser
// Express aldrig den rigtige protokol, og secure-cookien bliver aldrig sat.
app.set("trust proxy", isProduction ? 1 : false);
app.disable("x-powered-by");

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Better Auth læser den rå body selv og skal derfor monteres før express.json().
mountBetterAuth(app);

app.use(express.json({ limit: "2mb" }));

app.use("/api", authRouter);
app.use("/api/invites", invitesRouter);
app.use("/api/sync", syncRouter);
app.use("/api/games", gamesRouter);
app.use("/api/uploads", uploadsRouter);

// I produktion serverer nginx /uploads direkte og når aldrig hertil. Det her er
// for at udvikling og tests virker uden nginx.
app.use("/uploads", express.static(env.UPLOADS_DIR, { maxAge: "1d", fallthrough: false }));

// Terminal 404 for alt under /api der ikke matchede en rute ovenfor.
app.use("/api", (_req, _res, next: NextFunction) => {
  next(new HttpError(404, "Endpointet findes ikke."));
});

app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  if (error instanceof HttpError) {
    sendError(res, error);
    return;
  }
  console.error("Uventet fejl:", error);
  sendError(res, new HttpError(500, "Der gik noget galt."));
});
