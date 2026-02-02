import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import createApp from "@shopify/app-bridge";
import { getSessionToken } from "@shopify/app-bridge/utilities";

// ----------------------------
// APP BRIDGE INIT + HOST CHECK
// ----------------------------
const urlParams = new URLSearchParams(location.search);
let host = urlParams.get("host");
const shop = urlParams.get("shop"); // fallback for redirect

if (!host) {
  if (shop) {
    // Redirect user to embedded app URL inside Shopify Admin
    window.location.href = `https://${shop}/admin/apps/your-app-handle`;
    throw new Error("Redirecting to Shopify Admin to get host");
  } else {
    document.body.innerHTML =
      "<h1 style='color:red;text-align:center;margin-top:5rem'>Open from Shopify Admin</h1>";
    throw new Error("Missing host & shop query parameter");
  }
}

const app = createApp({
  apiKey: "fb97961e5486cf154aab95f63c4e32ee",
  host,
  forceRedirect: true,
});

// ----------------------------
// SESSION FETCH HELPER
// ----------------------------
const sessionFetch = async (input, init = {}) => {
  const token = await getSessionToken(app);
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
};

// ----------------------------
// VALIDATION HELPERS
// ----------------------------
const validateInput = (obj) => {
  if (typeof obj !== "object" || Array.isArray(obj)) {
    return 'Top-level JSON must be an object like { "ALU": "gid://shopify/ProductVariant/..." }';
  }
  for (const [code, gid] of Object.entries(obj)) {
    if (!/^[A-Z0-9]{3}$/.test(code)) {
      return `Material code "${code}" is invalid. Must be 3 uppercase letters or digits (e.g., ALU, AL1).`;
    }
    if (typeof gid !== "string" || !gid.startsWith("gid://shopify/ProductVariant/")) {
      return `Invalid variant GID for "${code}": ${gid}`;
    }
  }
  return null;
};

const verifyVariantsExist = async (obj) => {
  const variantList = Object.values(obj);

  const res = await sessionFetch(`/app/validate-variants?host=${encodeURIComponent(host)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ variants: variantList }),
  });

  if (!res.ok) return "Server could not validate variant IDs.";

  const data = await res.json();

  if (data.invalid?.length) {
    return `These variant IDs do NOT exist:\n\n${data.invalid.join("\n")}`;
  }

  return null;
};

const fetchVariantTitles = async (variants) => {
  const res = await sessionFetch(`/app/variant-titles?host=${encodeURIComponent(host)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ variants }),
  });

  if (!res.ok) throw new Error("Failed to fetch variant titles");

  return await res.json();
};

// ----------------------------
// APP COMPONENT
// ----------------------------
function App() {
  const [json, setJson] = useState("");
  const [original, setOriginal] = useState("");
  const [status, setStatus] = useState("Loading…");

  useEffect(() => {
    sessionFetch(`/app/config?host=${encodeURIComponent(host)}`)
      .then((r) => r.json())
      .then((data) => {
        const pretty = JSON.stringify(data, null, 2);
        setJson(pretty);
        setOriginal(pretty);
        setStatus("Ready");
      })
      .catch(() => setStatus("Failed to load"));
  }, []);

  const save = async () => {
    let parsed;

    // JSON syntax
    try {
      parsed = JSON.parse(json);
    } catch {
      alert("❌ JSON syntax is invalid.\nPlease correct it before saving.");
      return;
    }

    // Structure validation
    const structureError = validateInput(parsed);
    if (structureError) {
      alert("❌ " + structureError);
      return;
    }

    setStatus("Validating…");

    // Validate variant existence
    const variantError = await verifyVariantsExist(parsed);
    if (variantError) {
      alert("❌ " + variantError);
      setStatus("Validation failed");
      return;
    }

    // Fetch variant titles for confirmation
    const variantGIDs = Object.values(parsed);
    let titlesMap = {};
    try {
      titlesMap = await fetchVariantTitles(variantGIDs);
    } catch (err) {
      console.error(err);
      alert("❌ Failed to fetch variant titles for confirmation.");
      setStatus("Validation failed");
      return;
    }

    let confirmationText = "You are about to save the following mappings:\n\n";
    for (const [code, gid] of Object.entries(parsed)) {
      confirmationText += `${code}: ${titlesMap[gid] || "Unknown variant"}\n`;
    }

    if (!window.confirm(confirmationText)) {
      setStatus("Save cancelled");
      return;
    }

    setStatus("Saving…");
    try {
      const res = await sessionFetch(`/app/config?host=${encodeURIComponent(host)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });

      if (!res.ok) throw new Error("Bad response");

      setOriginal(json);
      setStatus("Saved!");
      setTimeout(() => setStatus("All changes saved"), 1500);
    } catch (err) {
      console.error(err);
      alert("❌ Save failed. Check console for details.");
      setStatus("Save failed");
    }
  };

  const hasChanges = json !== original;

  return (
    <div style={{ marginTop: "2rem" }}>
      <textarea
        value={json}
        onChange={(e) => setJson(e.target.value)}
        style={{
          width: "100%",
          height: "15vh",
          fontFamily: "Menlo, Monaco, monospace",
          fontSize: "14px",
          padding: "1rem",
          borderRadius: "6px",
          border: "1px solid #ccc",
        }}
      />
      <div style={{ marginTop: "1rem" }}>
        <button
          onClick={save}
          disabled={!hasChanges}
          style={{
            padding: "0.75rem 1.5rem",
            fontSize: "16px",
            background: hasChanges ? "#008060" : "#999",
            color: "white",
            border: "none",
            borderRadius: "6px",
            cursor: hasChanges ? "pointer" : "not-allowed",
          }}
        >
          {status.includes("Saving") ? "Saving…" : "Save"}
        </button>
      </div>
      <div className="status" style={{ marginTop: "0.5rem" }}>
        {status}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
