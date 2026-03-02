// server.js
import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { saveAccessToken, getAccessToken } from "./shopify.js";
import { generateState, verifyHmac } from "./oauth.js";
import { adjustInventoryDelta } from "./decrement_material.js";
import { syncMaterials, shopifyGraphQL, getRelations } from "./set_material_inv.js";

const MIN_DELAY = 0.5;

dotenv.config();

export const {
  SHOP,
  CLIENT_ID,
  CLIENT_SECRET,
  SCOPES,
  PORT,
  LOCATION_ID,
  APP_URL
} = process.env;

const app = express();
app.use(express.json());

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ---------------------------------------------------------
   IMPORTANT: API ROUTES MUST COME BEFORE STATIC + SPA CATCH
----------------------------------------------------------*/

// ---------- GET VARIANT TITLES ----------
app.post("/app/variant-titles", async (req, res) => {
  try {
    const { variants } = req.body;
    if (!Array.isArray(variants)) return res.status(400).json({ error: "Missing variants array" });

    const query = `
      query GetVariants($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id
            title
            product { title }
          }
        }
      }
    `;
    const result = await shopifyGraphQL(query, { ids: variants });

    const titles = {};
    for (const v of result.nodes || []) {
      if (v?.id) titles[v.id] = `${v.product?.title || "Unknown product"} - ${v.title}`;
    }

    res.json(titles);
  } catch (err) {
    console.error("variant-titles error:", err);
    res.status(500).json({ error: "Failed to fetch variant titles" });
  }
});

// ---------- VERIFY VARIANTS ----------
// Used to check whether the variants selected in the JSON in the app are valid
app.post("/app/validate-variants", async (req, res) => {
  try {
    const { variants } = req.body;

    if (!Array.isArray(variants)) {
      return res.status(400).json({ error: "Missing variant list" });
    }

    // Build a GraphQL query: fetch all variant nodes
    const query = `
      query CheckVariants($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id
          }
        }
      }
    `;

    const result = await shopifyGraphQL(query, { ids: variants });

    const returned = result.nodes.map(n => n?.id).filter(Boolean);
    const invalid = variants.filter(id => !returned.includes(id));

    res.json({ invalid });
  } catch (err) {
    console.error("validate-variants error:", err);
    res.status(500).json({ error: "Validation failed" });
  }
});

// ---------- CONFIG GET ----------
// This should probably just be getRelations...
app.get("/app/config", async (req, res) => {
  try {
    const result = await shopifyGraphQL(`
      query {
        shop {
          metafield(namespace: "material_sync", key: "relations") {
            value
          }
        }
      }
    `);

    const value = result?.shop?.metafield?.value || "{}";
    res.json(JSON.parse(value));
  } catch (e) {
    console.error("Config GET error:", e);
    res.status(500).json({});
  }
});

// ---------- CONFIG POST ----------
app.post("/app/config", async (req, res) => {
  try {
    const newMap = req.body;

    // Validate mappings
    for (const [code, gid] of Object.entries(newMap)) {
      if (!/^[A-Z0-9]{3}$/.test(code) || !gid?.startsWith?.("gid://shopify/ProductVariant/")) {
        return res.status(400).json({ error: "Invalid mapping data" });
      }
    }

    // Get shop ID (required for metafieldsSet)
    const shopResult = await shopifyGraphQL(`
      {
        shop { id }
      }
    `);

    const ownerId = shopResult?.shop?.id;
    if (!ownerId) {
      console.error("No shop ID returned");
      return res.status(500).json({ error: "Unable to determine shop ID" });
    }

    // Save metafield using metafieldsSet
    const mutation = `
      mutation SetMetafields($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
            key
            namespace
            type
            value
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `;

    const variables = {
      metafields: [
        {
          ownerId, // REQUIRED
          namespace: "material_sync",
          key: "relations",
          type: "json",
          value: JSON.stringify(newMap),
        }
      ]
    };

    const result = await shopifyGraphQL(mutation, variables);

    const errors = result?.metafieldsSet?.userErrors || [];
    if (errors.length > 0) {
      console.error("metafieldsSet errors:", errors);
      return res.status(400).json({ error: errors });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Config POST error:", err);
    res.status(500).json({ error: "Failed to save metafield" });
  }
});

/* ---------------------------------------------------------
   ENDPOINTS ABOVE — NOW STATIC APP
----------------------------------------------------------*/

// ---------- STATIC FRONTEND ----------
// Not even a clue what app.use does...
app.use(express.static(path.join(__dirname, "dist")));

// Vue/React Vite SPA: catch-all LAST
app.get(["/app", "/apps/*"], (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

/* ---------------------------------------------------------
   OAuth Install
----------------------------------------------------------*/
app.get("/install", (req, res) => {
  const nonce = crypto.randomBytes(16).toString("hex");

  const signedState = crypto
    .createHmac("sha256", CLIENT_SECRET)
    .update(nonce)
    .digest("hex") + ":" + nonce;

  const redirectUri = `${APP_URL}/auth/callback`;

  const installUrl =
    `https://${SHOP}/admin/oauth/authorize` +
    `?client_id=${CLIENT_ID}` +
    `&scope=${SCOPES}` +
    `&state=${signedState}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`;

  res.redirect(installUrl);
});

// app.get("/", (req, res) => {
//   const base = APP_URL;
//   const redirectUri = `${base}/auth/callback`;

//   const authUrl = `https://${SHOP}/admin/oauth/authorize?client_id=${CLIENT_ID}&scope=${SCOPES}&redirect_uri=${encodeURComponent(
//     redirectUri
//   )}`;

//   res.redirect(authUrl);
// });

app.get("/auth/callback", async (req, res) => {
  const { code, state, shop } = req.query;

  if (shop !== SHOP)
    return res.status(400).send("Shop mismatch");

  if (!verifyHmac(req.query))
    return res.status(400).send("HMAC validation failed");

  const [hmacPart, nonce] = state.split(":");

  const expected = crypto
    .createHmac("sha256", CLIENT_SECRET)
    .update(nonce)
    .digest("hex");

  if (hmacPart !== expected)
    return res.status(400).send("Invalid OAuth state");

  try {
    const tokenResponse = await fetch(
      `https://${SHOP}/admin/oauth/access_token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code
        })
      }
    );

    const data = await tokenResponse.json();

    if (!data.access_token)
      throw new Error("No access token returned");

    saveAccessToken(data.access_token);

    console.log("✅ Shopify installed successfully");

    res.send(`
      <h2>App Installed</h2>
      <p>You can close this tab.</p>
      <p>The server is now authenticated.</p>
    `);
  } catch (err) {
    console.error(err);
    res.status(500).send("OAuth failed");
  }
});

app.get("/health", (req, res) => {
  const tokenExists = !!getAccessToken();
  res.json({ installed: tokenExists });
});

/* ---------------------------------------------------------
   Webhook
----------------------------------------------------------*/
app.post("/webhook/orders/create", async (req, res) => {
  try {
    const order = req.body;
    console.log("Order webhook received:", order.id);

    const relations = await getRelations();
    const materialsToAdjust = {};

    for (const item of order.line_items || []) {
      const sku = (item.sku || "").toUpperCase();
      const qty = item.quantity || 0;

      for (const [material] of Object.entries(relations)) {
        if (sku.includes(material.toUpperCase())) {
          materialsToAdjust[material] =
            (materialsToAdjust[material] || 0) - qty;
          break;
        }
      }
    }

    if (Object.keys(materialsToAdjust).length === 0) {
      return res.status(200).send("No matching materials");
    }

    for (const [material, delta] of Object.entries(materialsToAdjust)) {
      const variantGid = relations[material];
      if (variantGid) await adjustInventoryDelta(variantGid, delta);
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("Webhook processing error:", err);
    res.status(500).send("Error");
  }
});

/* ---------------------------------------------------------
   Background Sync
----------------------------------------------------------*/
setInterval(syncMaterials, MIN_DELAY * 60_000);
syncMaterials();

/* ---------------------------------------------------------
   Start server
----------------------------------------------------------*/
const port = PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
  console.log(`Open this once to install the app:`);
  console.log(`${APP_URL}/install`);
});
