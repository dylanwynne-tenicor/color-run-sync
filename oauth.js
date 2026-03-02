import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const { CLIENT_SECRET } = process.env;

export function generateState() {
  return crypto.randomBytes(16).toString("hex");
}

export function verifyHmac(query) {
  const { hmac, signature, ...rest } = query;

  const message = Object.keys(rest)
    .sort()
    .map(k => `${k}=${Array.isArray(rest[k]) ? rest[k].join(",") : rest[k]}`)
    .join("&");

  const generated = crypto
    .createHmac("sha256", CLIENT_SECRET)
    .update(message)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(generated, "utf8"),
    Buffer.from(hmac, "utf8")
  );
}