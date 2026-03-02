import fetch from "node-fetch";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const {
  SHOP,
  API_VERSION
} = process.env;

const TOKEN_FILE = "./shopify_token.json";

export function getAccessToken() {
  if (!fs.existsSync(TOKEN_FILE)) return null;

  const saved = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
  return saved.access_token || null;
}

export function saveAccessToken(token) {
  fs.writeFileSync(
    TOKEN_FILE,
    JSON.stringify({ access_token: token }, null, 2)
  );
}

export async function shopifyFetch(path, options = {}) {
  const token = getAccessToken();
  if (!token) throw new Error("App not installed. Visit /install first.");

  const url = `https://${SHOP}/admin/api/${API_VERSION}/${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify API error (${res.status}): ${text}`);
  }

  return res.json();
}