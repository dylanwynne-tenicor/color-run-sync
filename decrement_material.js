import { shopifyGraphQL } from "./set_material_inv.js";
import { LOCATION_ID } from "./server.js";

// ========== HELPER: Adjust inventory delta ==========
// Used to update material inventory when a holster is sold
export async function adjustInventoryDelta(variantGid, delta) {
  const data = await shopifyGraphQL(`
    query getVariant($id: ID!) {
      node(id: $id) {
        ... on ProductVariant {
          inventoryItem { id }
        }
      }
    }
  `, { id: variantGid });

  const inventoryItemId = data?.node?.inventoryItem?.id;
  if (!inventoryItemId) {
    console.warn(`Could not get inventoryItem for variant ${variantGid}`);
    return;
  }

  console.log(`Adjusting inventory item ${inventoryItemId} by ${delta}`);

  const result = await shopifyGraphQL(`
    mutation inventoryAdjust($input: InventoryAdjustQuantitiesInput!) {
      inventoryAdjustQuantities(input: $input) {
        inventoryAdjustmentGroup { id }
        userErrors { field message }
      }
    }
  `, {
    input: {
      reason: "correction",
      name: "available",
      changes: [{
        delta,
        inventoryItemId,
        locationId: `gid://shopify/Location/${LOCATION_ID}`
      }]
    }
  });

  const errors = result?.inventoryAdjustQuantities?.userErrors || [];
  if (errors.length) {
    console.error("Adjustment errors:", errors);
    throw new Error(`Inventory adjustment failed: ${JSON.stringify(errors)}`);
  }
}