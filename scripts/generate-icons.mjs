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

mkdirSync(new URL("../public/icon/", import.meta.url), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const rows = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const px = x / size,
        py = y / size;
      const inset = 0.05,
        radius = 0.17;
      const dx = Math.max(inset + radius - px, 0, px - (1 - inset - radius));
      const dy = Math.max(inset + radius - py, 0, py - (1 - inset - radius));
      const inside =
        px >= inset &&
        px <= 1 - inset &&
        py >= inset &&
        py <= 1 - inset &&
        dx * dx + dy * dy <= radius * radius;
      let color = inside ? [52, 95, 156, 255] : [0, 0, 0, 0];
      if (px > 0.23 && px < 0.77 && py > 0.25 && py < 0.78)
        color = [255, 255, 255, 255];
      if (px > 0.23 && px < 0.77 && py > 0.34 && py < 0.4)
        color = [52, 95, 156, 255];
      for (const gx of [0.33, 0.55])
        for (const gy of [0.49, 0.65])
          if (px > gx && px < gx + 0.12 && py > gy && py < gy + 0.08)
            color = [52, 95, 156, 255];
      const offset = y * (1 + size * 4) + 1 + x * 4;
      rows.set(color, offset);
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
