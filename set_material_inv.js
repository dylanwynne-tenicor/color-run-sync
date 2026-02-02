import fs from "fs";
import { LOCATION_ID, SHOP } from "./server.js";

const TOKEN_FILE = "./shopify_token.json";

// ---------- GRAPHQL CLIENT ----------
export async function shopifyGraphQL(query, variables = {}) {
  
  const token = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8")).access_token;

  const response = await fetch(`https://${SHOP}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await response.json();

  if (json.errors) {
    console.error("GraphQL errors:", json.errors);
    return {};
  }

  return json.data || {};
}

// ---------- OTHER HELPERS ----------
export async function getRelations() {
  const data = await shopifyGraphQL(`
    query {
      shop {
        metafield(namespace: "material_sync", key: "relations") {
          value
        }
      }
    }
  `);
  return JSON.parse(data?.shop?.metafield?.value || "{}");
}

async function findVariantsByMaterial(material) {
  const q = `sku:*${material} AND product_title:*color-run* AND NOT sku:Color-${material}`; // Color-material is the material sku itself
  
  let cursor = null;
  const allNodes = [];

  while (true) {
    const data = await shopifyGraphQL(`
      query Variants($query: String!, $cursor: String) {
        productVariants(first: 250, query: $query, after:$cursor) {
          nodes { id sku inventoryItem { id } product { title } }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }`, { query: q, cursor });

    const connection = data?.productVariants;
    if (!connection) break;

    allNodes.push(...(connection.nodes || []));

    if (!connection.pageInfo?.hasNextPage) break;
    cursor = connection.pageInfo.endCursor;
  }

  console.log(allNodes);
  return allNodes;
}

async function getVariantById(variantGid) {
  const query = `
    query getVariant($id: ID!) {
      node(id: $id) {
        ... on ProductVariant {
          id sku
          inventoryItem { id }
        }
      }
    }
  `;
  const data = await shopifyGraphQL(query, { id: variantGid });
  return data?.node || null;
}

// ---------- BULK INVENTORY READ ----------
async function getInventoryLevelsBulk(locationId, inventoryItemIds) {
  if (!inventoryItemIds?.length) return {};

  const query = `
    query GetInventoryLevels($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on InventoryItem {
          id
          inventoryLevels(first: 1, query: "location_id:${locationId}") {
            nodes {
              quantities(names: ["available"]) {
                quantity
              }
            }
          }
        }
      }
    }
  `;

  const resp = await shopifyGraphQL(query, { ids: inventoryItemIds });

  if (!resp || !Array.isArray(resp.nodes)) {
    console.warn("getInventoryLevelsBulk: Invalid response", resp);
    return {};
  }

  const out = {};
  for (const node of resp.nodes) {
    if (!node) continue;
    const level = node.inventoryLevels?.nodes?.[0];
    const qty = level?.quantities?.[0]?.quantity ?? 0;
    out[node.id] = qty;
  }
  return out;
}

// ---------- BULK ADJUST ----------
// Actually sets invnetory quantities for all color run products
async function bulkAdjust(locationGID, changes) {
  if (!changes?.length) {
    console.log("No changes to adjust, skipping bulkAdjust");
    return true;
  }

  const input = {
    reason: "correction",
    name: "available",
    changes: changes.map(c => ({
      inventoryItemId: c.inventoryItemId,
      delta: c.availableDelta,
      locationId: locationGID
    }))
  };

//   console.log("bulkAdjust input:", JSON.stringify(input, null, 2));

  const result = await shopifyGraphQL(`
    mutation Adjust($input: InventoryAdjustQuantitiesInput!) {
      inventoryAdjustQuantities(input: $input) {
        inventoryAdjustmentGroup { id }
        userErrors { field message }
      }
    }
  `, { input });

  if (!result?.inventoryAdjustQuantities) {
    throw new Error("Missing inventoryAdjustQuantities response");
  }

  const errors = result.inventoryAdjustQuantities.userErrors || [];
  if (errors.length) {
    console.error("bulkAdjust userErrors:", errors);
    throw new Error(JSON.stringify(errors));
  }

  return true;
}

// ---------- SYNC MATERIAL ----------
// Function runs for each material. Args:
// material - the three letter code key in relations.json
// canonicalGID - the GID string that is the value of relations.json
// locationGID - set in .env
async function syncMaterial(material, canonicalGID, locationGID) {
  console.log("Syncing material:", material);

  const canonical = await getVariantById(canonicalGID);
  if (!canonical) {
    console.warn(`Canonical variant not found: ${canonicalGID}`);
    return;
  }

  const canonicalItemId = canonical.inventoryItem.id;
  const levels = await getInventoryLevelsBulk(LOCATION_ID, [canonicalItemId]);
  const canonicalQty = levels[canonicalItemId];

  console.log(`Available: ${canonicalQty}`);

  if (canonicalQty == null) {
    console.warn(`Canonical quantity not found for ${material}`);
    return;
  }

  const dependents = await findVariantsByMaterial(material);
  console.log(`Found dependents: ${Object.keys(dependents).length}`)

  const dependentItems = dependents
    .filter(v => v.product.title.includes("Color Run")) // extremely important, since other products may contain the string
    .map(v => v.inventoryItem.id);

  if (!dependentItems.length) {
    console.log(`No dependent variants to sync for ${material}`);
    return;
  }

  const depLevels = await getInventoryLevelsBulk(LOCATION_ID, dependentItems);

  const changes = dependentItems
    .map(id => {
      const delta = canonicalQty - (depLevels[id] ?? 0);
      if (delta === 0) return null;
      return { inventoryItemId: id, availableDelta: delta };
    })
    .filter(Boolean);

  if (!changes.length) {
    console.log(`All dependent variants already in sync for ${material}`);
    return;
  }

  console.log(`Applying ${changes.length} inventory adjustments for ${material}`);
  await bulkAdjust(locationGID, changes);

  console.log(`Material ${material} synced`);
}

// ---------- FULL SYNC ----------
export async function syncMaterials() {
  console.log("Bulk inventory sync started");

  const relations = await getRelations();
  const locationGID = `gid://shopify/Location/${LOCATION_ID}`;

  for (const material of Object.keys(relations)) {
    const canonicalVariantId = relations[material];
    if (!canonicalVariantId) {
      console.warn(`No canonical variant GID for material: ${material}`);
      continue;
    }
    await syncMaterial(material, canonicalVariantId, locationGID);
  }

  console.log("All materials bulk-synced\n");
}