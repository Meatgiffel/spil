import { z } from "zod";

// Nøglen vises kun én gang ved oprettelse og gemmes kun som sha256 i databasen.
// Alfabetet er flagdags forvekslingsfrie sæt — ingen 0/O eller 1/l.
export const INVITE_KEY_ALPHABET = "23456789abcdefghijkmnopqrstuvwxyz";
export const INVITE_KEY_GROUP_LENGTH = 4;
export const INVITE_KEY_GROUPS = 3;

const inviteKeyPattern = new RegExp(
  `^[${INVITE_KEY_ALPHABET}]{${INVITE_KEY_GROUP_LENGTH}}(-[${INVITE_KEY_ALPHABET}]{${INVITE_KEY_GROUP_LENGTH}}){${INVITE_KEY_GROUPS - 1}}$`,
);

export const inviteKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(inviteKeyPattern, { error: "invite_key_format" });

export const signUpSchema = z.object({
  email: z.email({ error: "email_invalid" }),
  name: z
    .string()
    .trim()
    .min(1, { error: "name_required" })
    .max(80, { error: "name_too_long" }),
  password: z
    .string()
    // Bevidst lavt og uden krav til tegntyper: appen er lukket bag en
    // invitationsnøgle, og login er rate-limitet til 10 forsøg pr. kvarter pr.
    // IP. Kravene skal matche server/src/auth.ts.
    .min(6, { error: "password_min" })
    .max(200, { error: "password_max" }),
  inviteKey: inviteKeySchema,
});

// Førstegangsopsætning: første bruger i en tom installation bliver admin uden nøgle.
export const setupSchema = signUpSchema.omit({ inviteKey: true });

export const createInviteKeySchema = z.object({
  label: z.string().trim().max(80).nullable().default(null),
  maxUses: z.number().int().min(1).max(1000).default(1),
  expiresAt: z.number().int().min(0).nullable().default(null),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SetupInput = z.infer<typeof setupSchema>;
export type CreateInviteKeyInput = z.infer<typeof createInviteKeySchema>;
