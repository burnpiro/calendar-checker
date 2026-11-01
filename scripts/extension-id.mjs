import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const { publicKey } = JSON.parse(
  readFileSync(
    new URL("../config/extension-key.json", import.meta.url),
    "utf8",
  ),
);
const extensionId = [
  ...createHash("sha256")
    .update(Buffer.from(publicKey, "base64"))
    .digest()
    .subarray(0, 16),
]
  .map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15)))
  .join("");

console.log(extensionId);
