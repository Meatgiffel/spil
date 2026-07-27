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
  .regex(inviteKeyPattern, { error: "Invitationsnøglen har ikke det rigtige format." });

export const signUpSchema = z.object({
  email: z.email({ error: "Indtast en gyldig e-mailadresse." }),
  name: z
    .string()
    .trim()
    .min(1, { error: "Navnet må ikke være tomt." })
    .max(80, { error: "Navnet må højst være 80 tegn." }),
  password: z
    .string()
    // Bevidst lavt og uden krav til tegntyper: appen er lukket bag en
    // invitationsnøgle, og login er rate-limitet til 10 forsøg pr. kvarter pr.
    // IP. Kravene skal matche server/src/auth.ts.
    .min(6, { error: "Kodeordet skal være mindst 6 tegn." })
    .max(200, { error: "Kodeordet må højst være 200 tegn." }),
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
