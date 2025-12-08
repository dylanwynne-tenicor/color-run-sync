// shopify.js
import fetch from "node-fetch";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const {
  SHOP,
  CLIENT_ID,
  CLIENT_SECRET,
  API_VERSION,
} = process.env;

const TOKEN_FILE = "./shopify_token.json";

export async function getAccessToken() {
  if (fs.existsSync(TOKEN_FILE)) {
    const saved = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
    if (saved.access_token) return saved.access_token;
  }
  throw new Error("No saved access token. Run OAuth flow first.");
}

export async function saveAccessToken(token) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ access_token: token }, null, 2));
}

export async function shopifyFetch(path, options = {}) {
  const token = await getAccessToken();
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
