Below are instructions for setting up shopify to call the webhook running in gcloud.

Before running any of the below commands, enter into the correct directory with the following terminal command: cd ~/Tenicor\ Dropbox/6\ Operations/Inventory/Color\ Run/Color\ Run\ App

# SETUP

Run this command in the terminal to register the webhook. Double check that the "address" field matches the url on gcloud.

curl -X POST "https://tenicor.myshopify.com/admin/api/2025-07/webhooks.json" \
  -H "X-Shopify-Access-Token: $(jq -r .access_token shopify_token.json)" \
  -H "Content-Type: application/json" \
  -d '{"webhook":{"topic":"orders/create","address":"https://color-run-sync-git-128710390300.us-west1.run.app/webhook/orders/create","format":"json"}}'

# SHUTDOWN

First, get all registered webhooks:

curl -X GET \
  "https://tenicor.myshopify.com/admin/api/2025-07/webhooks.json" \
  -H "X-Shopify-Access-Token: $(jq -r .access_token shopify_token.json)"

Then delete the registered webhook (only one should be displayed) by replacing <webhook_id> in the below command with the id found by the previous command.

curl -X DELETE \
  "https://tenicor.myshopify.com/admin/api/2025-07/webhooks/<webhook_id>.json" \
  -H "X-Shopify-Access-Token: $(jq -r .access_token shopify_token.json)"

# FIRST TIME SETUP

If this is the first time running the app, a metafield must be created to store material relations information. This is done with the below command.

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
