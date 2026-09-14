const fs = require("fs");
const path = require("path");

const outputPath = path.resolve(__dirname, "..", "supabase-config.js");
const url = String(process.env.SUPABASE_URL || "").trim();
const publishableKey = String(
  process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "",
).trim();

if (!url || !publishableKey) {
  if (fs.existsSync(outputPath) && !process.env.VERCEL) {
    console.log("Using the existing local Supabase browser configuration.");
    process.exit(0);
  }

  throw new Error(
    "SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY) are required to build the browser configuration.",
  );
}

if (/sb_secret|service_role/i.test(publishableKey)) {
  throw new Error("A service-role or secret key cannot be used in the browser configuration.");
}

const output = `window.__WII_SUPABASE_CONFIG__ = ${JSON.stringify(
  { url, publishableKey },
  null,
  2,
)};\n`;

fs.writeFileSync(outputPath, output, "utf8");
console.log("Generated the browser-safe Supabase configuration.");
