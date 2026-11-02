// Generate local calendar icons without fetching assets or requiring an image service.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

function chunk(type, data) {
  const name = Buffer.from(type);
  const payload = Buffer.concat([name, data]);
  let checksum = 0xffffffff;
  for (const byte of payload) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit++)
      checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE((checksum ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, payload, crc]);
}

// The calendar itself fills the canvas: no enclosing tile, stroke, or padding.
function roundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const dx = Math.max(left + radius - x, 0, x - (right - radius));
  const dy = Math.max(top + radius - y, 0, y - (bottom - radius));
  return dx * dx + dy * dy <= radius * radius;
}
function pixelColor(x, y) {
  let color = null;
  if (roundedRect(x, y, 0, 0.1, 1, 1, 0.1)) {
    color = y < 0.36 ? [52, 95, 156] : [243, 247, 253];
    for (const column of [0.16, 0.42, 0.68])
      for (const row of [0.47, 0.7])
        if (roundedRect(x, y, column, row, column + 0.16, row + 0.14, 0.025))
          color = [52, 95, 156];
  }
  for (const binding of [0.23, 0.66])
    if (roundedRect(x, y, binding, 0, binding + 0.11, 0.23, 0.045))
      color = [37, 71, 121];
  return color;
}
mkdirSync(new URL("../public/icon/", import.meta.url), { recursive: true });
for (const size of [16, 24, 32, 48, 128]) {
  const rows = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      // Supersample locally for clean edges at toolbar and Retina resolutions.
      const sum = [0, 0, 0];
      let covered = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const color = pixelColor(
            (x + (sx + 0.5) / 4) / size,
            (y + (sy + 0.5) / 4) / size,
          );
          if (!color) continue;
          covered++;
          color.forEach((value, channel) => {
            sum[channel] += value;
          });
        }
      const offset = y * (1 + size * 4) + 1 + x * 4;
      rows.set(
        covered
          ? [
              ...sum.map((value) => Math.round(value / covered)),
              Math.round((255 * covered) / 16),
            ]
          : [0, 0, 0, 0],
        offset,
      );
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  writeFileSync(new URL(`../public/icon/${size}.png`, import.meta.url), png);
}
