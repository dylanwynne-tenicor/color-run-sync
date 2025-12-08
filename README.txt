The below is a handful of tools for setting up the app.
1. A webhook must be registered to ping the correct url when an order is created.
2. A metafield must also be created to store the three letter code / variant ID relations

To register a webhook:

curl -X POST "https://tenicor.myshopify.com/admin/api/2025-07/webhooks.json" \
  -H "X-Shopify-Access-Token: $(jq -r .access_token shopify_token.json)" \
  -H "Content-Type: application/json" \
  -d '{"webhook":{"topic":"orders/create","address":"https://inescapable-vinnie-sacrificeable.ngrok-free.dev/webhook/orders/create","format":"json"}}'

To delete a webhook:

curl -X DELETE \
  "https://tenicor.myshopify.com/admin/api/2025-07/webhooks/<webhook_id>.json" \
  -H "X-Shopify-Access-Token: $(jq -r .access_token shopify_token.json)"

To get all webhooks:

curl -X GET \
  "https://tenicor.myshopify.com/admin/api/2025-07/webhooks.json" \
  -H "X-Shopify-Access-Token: $(jq -r .access_token shopify_token.json)"

Create metafield for material code / material sku relation:

curl -X POST "https://tenicor.myshopify.com/admin/api/2025-10/metafields.json" \
  -H "X-Shopify-Access-Token: $(jq -r .access_token shopify_token.json)" \
  -H "Content-Type: application/json" \
  -d '{
        "metafield": {
          "namespace": "material_sync",
          "key": "relations",
          "value": "{}",
          "type": "json"
        }
      }'
