import { expect, test, type Page } from "@playwright/test";

/**
 * Den her test er grunden til at appen findes: man skal kunne registrere et
 * parti ved spillebordet uden net, og det skal dukke op på de andres telefoner
 * bagefter. Enhedstests kan ikke vise det — det kræver en rigtig browser med
 * IndexedDB, en service worker og netværket slået fra.
 */

const KODEORD = "et-langt-kodeord";
const EMAIL = "casper@example.com";

async function opretAdministrator(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /ingen her endnu/i })).toBeVisible();
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Navn").fill("Casper");
  await page.getByLabel("Kodeord").fill(KODEORD);
  await page.getByRole("button", { name: "Opret administrator" }).click();
  await expect(page.getByRole("button", { name: "Registrer parti" })).toBeVisible();
}

async function logInd(page: Page) {
  await page.goto("/");
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByLabel("Kodeord").fill(KODEORD);
  await page.getByRole("button", { name: "Log ind", exact: true }).click();
}

async function opretGruppe(page: Page, navn: string) {
  await page.getByRole("link", { name: "Grupper" }).click();
  await page.getByRole("button", { name: "Ny gruppe" }).click();
  await page.getByLabel("Navn på gruppen").fill(navn);
  await page.getByRole("button", { name: "Opret", exact: true }).click();
  await expect(page.getByRole("link", { name: new RegExp(navn) })).toBeVisible();
}

/** Kører hele registreringsflowet igennem: spil → hvem → placeringer → detaljer. */
async function registrerParti(page: Page, spil: string) {
  await page.getByRole("link", { name: "Hjem" }).click();
  await page.getByRole("button", { name: "Registrer parti" }).click();

  // Trin 0: vælg gruppe. Listen kommer fra IndexedDB, så den skal ventes ind.
  await expect(page.getByRole("heading", { name: "Hvilken gruppe?" })).toBeVisible();
  await page.getByRole("button", { name: /Spilklubben/ }).click();

  await page.getByLabel("Søg i biblioteket").fill(spil);
  await page.getByRole("button", { name: new RegExp(`Opret .${spil}`) }).click();

  await page.getByRole("button", { name: /Casper/ }).click();
  await page.getByRole("button", { name: /Videre · 1 spiller/ }).click();

  // Placeringer: ét tryk gør Casper til vinder.
  await page.getByRole("button", { name: /Casper/ }).click();
  await expect(page.getByRole("button", { name: /Casper VINDER/ })).toBeVisible();
  await page.getByRole("button", { name: "Videre" }).click();

  await page.getByRole("button", { name: "Gem parti" }).click();
  await expect(page.getByRole("heading", { name: spil })).toBeVisible();
}

test("et parti oprettet offline dukker op på en anden enhed", async ({ browser }) => {
  const enhedA = await browser.newContext();
  const sideA = await enhedA.newPage();

  await opretAdministrator(sideA);
  await opretGruppe(sideA, "Spilklubben");

  // ── Offline ────────────────────────────────────────────────────────────
  await enhedA.setOffline(true);

  await expect(sideA.getByText(/Offline/)).toBeVisible({ timeout: 15_000 });

  await registrerParti(sideA, "Vingespil");

  // Partiet er synligt med det samme, og markeret som ikke-sendt.
  await sideA.getByRole("link", { name: "Hjem" }).click();
  await expect(sideA.getByText("Vingespil")).toBeVisible();
  await expect(sideA.getByText("Gemmes senere").first()).toBeVisible();

  // App'en skal også kunne genindlæses uden net — det er hele pointen med PWA'en.
  await sideA.reload();
  await expect(sideA.getByText("Vingespil")).toBeVisible({ timeout: 15_000 });

  // ── Online igen ────────────────────────────────────────────────────────
  await enhedA.setOffline(false);

  // Køen skal tømmes af sig selv.
  await expect(sideA.getByText("Gemmes senere")).toHaveCount(0, { timeout: 30_000 });

  // ── En anden enhed ─────────────────────────────────────────────────────
  const enhedB = await browser.newContext();
  const sideB = await enhedB.newPage();
  await logInd(sideB);

  await expect(sideB.getByText("Vingespil")).toBeVisible({ timeout: 30_000 });
  await expect(sideB.getByText(/Casper vandt/)).toBeVisible();

  await enhedA.close();
  await enhedB.close();
});
