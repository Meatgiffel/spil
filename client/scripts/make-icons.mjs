// Genererer app-ikonerne som rigtige PNG'er uden nogen afhængigheder.
//
// Ikonet er en terning i designsystemets accentfarve: ingen eksterne assets,
// ingen billedbehandlingsbibliotek, og filerne kan committes.
//
// Kør: node scripts/make-icons.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ACCENT = [0xec, 0x30, 0x13];
const INK = [0xf3, 0xf2, 0xf2];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, pixel) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bitdybde
  header[9] = 2; // farvetype: RGB
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let offset = 0;
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0; // filter: none
    offset += 1;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = pixel(x, y);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      offset += 3;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Terningens fem øjne, i enhedskoordinater.
const PIPS = [
  [0.3, 0.3],
  [0.7, 0.3],
  [0.5, 0.5],
  [0.3, 0.7],
  [0.7, 0.7],
];

function draw(size) {
  const radius = size * 0.075;
  // Maskable-ikoner beskæres til en cirkel, så motivet holdes inden for midten.
  return (x, y) => {
    for (const [px, py] of PIPS) {
      const dx = x - px * size;
      const dy = y - py * size;
      if (dx * dx + dy * dy <= radius * radius) return INK;
    }
    return ACCENT;
  };
}

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "..", "public");
mkdirSync(publicDir, { recursive: true });

for (const size of [192, 512]) {
  writeFileSync(path.join(publicDir, `icon-${size}.png`), png(size, draw(size)));
  console.log(`icon-${size}.png`);
}

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#ec3013"/>
  ${PIPS.map(([x, y]) => `<circle cx="${x * 100}" cy="${y * 100}" r="7.5" fill="#f3f2f2"/>`).join(
    "\n  ",
  )}
</svg>
`;
writeFileSync(path.join(publicDir, "favicon.svg"), favicon);
console.log("favicon.svg");
