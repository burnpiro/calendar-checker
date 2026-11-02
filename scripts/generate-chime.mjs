import { mkdir, writeFile } from "node:fs/promises";

// Original, locally synthesized one-second chime; no downloaded media.
const rate = 22050;
const pcm = Buffer.alloc(rate * 2);
for (let i = 0; i < rate; i++) {
  const t = i / rate;
  const envelope = Math.max(0, 1 - t) ** 3 * Math.min(1, t * 40);
  const wave =
    0.6 * Math.sin(2 * Math.PI * 660 * t) +
    0.4 * Math.sin(2 * Math.PI * 880 * t);
  pcm.writeInt16LE(Math.trunc(12000 * envelope * wave), i * 2);
}
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write("WAVEfmt ", 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(rate, 24);
header.writeUInt32LE(rate * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(pcm.length, 40);
await mkdir(new URL("../public/sounds/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../public/sounds/chime.wav", import.meta.url),
  Buffer.concat([header, pcm]),
);
