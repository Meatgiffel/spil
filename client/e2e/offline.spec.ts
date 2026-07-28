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
  await expect(page.getByRole("heading", { name: /nobody is here yet/i })).toBeVisible();
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Name").fill("Casper");
  await page.getByLabel("Password").fill(KODEORD);
  await page.getByRole("button", { name: "Create administrator" }).click();
  await expect(page.getByRole("button", { name: "Record play" })).toBeVisible();
}

async function logInd(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(KODEORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function opretGruppe(page: Page, navn: string) {
  await page.getByRole("link", { name: "Groups" }).click();
  await page.getByRole("button", { name: "New group" }).click();
  await page.getByLabel("Group name").fill(navn);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("link", { name: new RegExp(navn) })).toBeVisible();
}

/** Kører hele registreringsflowet igennem: spil → hvem → placeringer → detaljer. */
async function registrerParti(page: Page, spil: string) {
  await page.getByRole("link", { name: "Home" }).click();
  await page.getByRole("button", { name: "Record play" }).click();

  // Trin 0: vælg gruppe. Listen kommer fra IndexedDB, så den skal ventes ind.
  await expect(page.getByRole("heading", { name: "Which group?" })).toBeVisible();
  await page.getByRole("button", { name: /Spilklubben/ }).click();

  await page.getByLabel("Search games").fill(spil);
  await page.getByRole("button", { name: new RegExp(`Create .${spil}`) }).click();

  await page.getByRole("button", { name: /Casper/ }).click();
  await page.getByRole("button", { name: /Next · 1 player/ }).click();

  // Placeringer: ét tryk gør Casper til vinder.
  await page.getByRole("button", { name: /Casper/ }).click();
  await expect(page.getByRole("button", { name: /Casper WINNER/ })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await page.getByRole("button", { name: "Save play" }).click();
  await expect(page.getByRole("heading", { name: spil })).toBeVisible();
}

// Serielt og i denne rækkefølge: begge tests deler den samme server og
// database, og den første opretter den administrator den anden logger ind som.
// Uden serial ville rækkefølgen være tilfældig — og testen dermed flaky.
test.describe.configure({ mode: "serial" });

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
  await sideA.getByRole("link", { name: "Home" }).click();
  await expect(sideA.getByText("Vingespil")).toBeVisible();
  await expect(sideA.getByText("Saved later").first()).toBeVisible();

  // App'en skal også kunne genindlæses uden net — det er hele pointen med PWA'en.
  await sideA.reload();
  await expect(sideA.getByText("Vingespil")).toBeVisible({ timeout: 15_000 });

  // ── Online igen ────────────────────────────────────────────────────────
  await enhedA.setOffline(false);

  // Køen skal tømmes af sig selv.
  await expect(sideA.getByText("Saved later")).toHaveCount(0, { timeout: 30_000 });

  // ── En anden enhed ─────────────────────────────────────────────────────
  const enhedB = await browser.newContext();
  const sideB = await enhedB.newPage();
  await logInd(sideB);

  await expect(sideB.getByText("Vingespil")).toBeVisible({ timeout: 30_000 });
  await expect(sideB.getByText(/Casper won/)).toBeVisible();

  await enhedA.close();
  await enhedB.close();
});

test("sproget kan skiftes og huskes på tværs af genindlæsninger", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await logInd(page);

  // App'en starter på engelsk.
  await expect(page.getByRole("link", { name: "Groups" })).toBeVisible();
  expect(await page.locator("html").getAttribute("lang")).toBe("en");

  await page.getByRole("link", { name: "Profile" }).click();

  // Versionen skal kunne ses i UI'et. Den er bagt ind under bygningen, og
  // e2e-bygningen kører uden release-scriptets variabler — derfor "dev".
  await expect(page.getByRole("heading", { name: "Version" })).toBeVisible();
  await expect(page.getByText("dev", { exact: true })).toBeVisible();
  await expect(page.getByText("Development build")).toBeVisible();

  await page.getByRole("button", { name: "Dansk" }).click();

  // Hele appen skifter med det samme, ikke først ved næste indlæsning.
  await expect(page.getByRole("link", { name: "Grupper" })).toBeVisible();
  expect(await page.locator("html").getAttribute("lang")).toBe("da");

  // Valget ligger i localStorage, så det holder også uden net — og skrivningen
  // er synkron, så den ikke kan nå at blive afbrudt af en genindlæsning.
  await page.reload();
  await expect(page.getByRole("link", { name: "Grupper" })).toBeVisible({
    timeout: 15_000,
  });
  expect(await page.locator("html").getAttribute("lang")).toBe("da");

  await ctx.close();
});
