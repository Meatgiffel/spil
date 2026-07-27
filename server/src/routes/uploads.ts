import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { v7 as uuidv7 } from "uuid";
import { assertGroupAccess, playGroupId } from "../access.js";
import { env } from "../env.js";
import { badRequest, notFound } from "../http.js";
import { requireUser } from "../session.js";

// Filerne skrives selv, ikke af multer: så ligger navngivning og placering ét
// sted, og en fil kan aldrig lande på disken før adgangen er tjekket.
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!(file.mimetype in EXTENSIONS)) {
      callback(badRequest("Filtypen understøttes ikke. Brug JPEG, PNG, WebP eller HEIC."));
      return;
    }
    callback(null, true);
  },
});

export const uploadsRouter: Router = Router();

uploadsRouter.use(requireUser);

uploadsRouter.post("/", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) throw badRequest("Der var ingen fil med.");

    const playId = String(req.body?.playId ?? "");
    if (!playId) throw badRequest("Billedet mangler et parti.");

    // Adgangsgrænsen er gruppen — også for filer.
    const groupId = playGroupId(playId);
    if (!groupId) throw notFound("Partiet findes ikke.");
    assertGroupAccess(req.user!.id, groupId);

    const extension = EXTENSIONS[req.file.mimetype]!;
    const filename = `${uuidv7()}${extension}`;
    const directory = path.join(env.UPLOADS_DIR, "plays");
    mkdirSync(directory, { recursive: true });
    await writeFile(path.join(directory, filename), req.file.buffer);

    res.status(201).json({ filePath: `/uploads/plays/${filename}` });
  } catch (error) {
    next(error);
  }
});
