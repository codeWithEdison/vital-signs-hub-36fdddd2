/**
 * Smoke-test external HTTP APIs used by this project.
 * Reads `.env` in repo root for Supabase URL/key and optional model URL.
 *
 * Usage: node scripts/test-apis.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadEnv(path) {
  const env = {};
  if (!existsSync(path)) return env;
  const text = readFileSync(path, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\r$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[m[1]] = v;
  }
  return env;
}

const fileEnv = {
  ...loadEnv(join(root, ".env")),
  ...loadEnv(join(process.cwd(), ".env")),
};
// Allow overrides without editing `.env` (e.g. when default model port is busy).
const env = { ...fileEnv };
for (const key of ["VITE_MODEL_API_URL", "VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"]) {
  if (process.env[key]) env[key] = process.env[key];
}
const MODEL_BASE = (env.VITE_MODEL_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const SUPABASE_URL = (env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

function ok(name, passed, detail = "") {
  const s = passed ? "PASS" : "FAIL";
  console.log(`[${s}] ${name}${detail ? `: ${detail}` : ""}`);
  return passed;
}

async function main() {
  let failures = 0;

  // --- Local model (FastAPI) ---
  try {
    const h = await fetch(`${MODEL_BASE}/health`);
    const j = await h.json().catch(() => ({}));
    if (!ok("GET model /health", h.ok, JSON.stringify(j))) failures++;
  } catch (e) {
    ok("GET model /health", false, String(e));
    failures++;
  }

  try {
    const h = await fetch(`${MODEL_BASE}/openapi.json`);
    if (!ok("GET model /openapi.json", h.ok, `HTTP ${h.status}`)) failures++;
  } catch (e) {
    ok("GET model /openapi.json", false, String(e));
    failures++;
  }

  try {
    const h = await fetch(`${MODEL_BASE}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ temperature: 37.0, heart_rate: 72, spo2: 98 }),
    });
    const text = await h.text();
    const short = text.length > 200 ? `${text.slice(0, 200)}…` : text;
    if (!ok("POST model /predict", h.ok, `HTTP ${h.status} ${short}`)) failures++;
  } catch (e) {
    ok("POST model /predict", false, String(e));
    failures++;
  }

  let sampleVitalId;

  // --- Supabase REST ---
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.log("[SKIP] Supabase REST (missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY in .env)");
  } else {
    try {
      const h = await fetch(`${SUPABASE_URL}/rest/v1/vitals?select=id&limit=1`, {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      });
      const rows = await h.json().catch(() => []);
      if (!ok("GET rest /vitals", h.ok && Array.isArray(rows), `HTTP ${h.status}`)) failures++;
      sampleVitalId = rows[0]?.id;
    } catch (e) {
      ok("GET rest /vitals", false, String(e));
      failures++;
    }
  }

  // --- Edge function persist-vital ---
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.log("[SKIP] Edge persist-vital (missing Supabase env)");
  } else {
    const edgeUrl = `${SUPABASE_URL}/functions/v1/persist-vital`;

    try {
      const h = await fetch(edgeUrl, {
        method: "OPTIONS",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      });
      if (!ok("OPTIONS edge persist-vital", h.ok, `HTTP ${h.status}`)) failures++;
    } catch (e) {
      ok("OPTIONS edge persist-vital", false, String(e));
      failures++;
    }

    try {
      const h = await fetch(edgeUrl, {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const body = await h.text();
      if (!ok("POST persist-vital (no vital_id → 400)", h.status === 400, `HTTP ${h.status} ${body.slice(0, 120)}`)) {
        failures++;
      }
    } catch (e) {
      ok("POST persist-vital (no vital_id)", false, String(e));
      failures++;
    }

    try {
      const h = await fetch(edgeUrl, {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          vital_id: "00000000-0000-4000-8000-000000000001",
        }),
      });
      if (!ok("POST persist-vital (unknown id → 404)", h.status === 404, `HTTP ${h.status}`)) failures++;
    } catch (e) {
      ok("POST persist-vital (unknown id)", false, String(e));
      failures++;
    }

    const vid = sampleVitalId;
    if (vid) {
      try {
        const h = await fetch(edgeUrl, {
          method: "POST",
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            vital_id: vid,
            model_status: "SAFE",
            final_status: "SAFE",
            model_confidence: 0.9,
            decision_source: "model",
            recommendation: "You are in good health",
          }),
        });
        const body = await h.text();
        if (!ok("POST persist-vital (vital_id + model fields, server loads vitals)", h.ok, `HTTP ${h.status} ${body.slice(0, 160)}`)) {
          failures++;
        }
      } catch (e) {
        ok("POST persist-vital (real row)", false, String(e));
        failures++;
      }
    } else {
      console.log("[SKIP] POST persist-vital happy path (no sample vital id from REST)");
    }
  }

  console.log(failures === 0 ? "\nAll runnable checks passed." : `\n${failures} check(s) failed.`);
  if (failures > 0) {
    console.log(
      "\nIf POST /predict failed with HTTP 500: upgrade sklearn to match the bundle (see model/requirements.txt) and restart uvicorn.\n" +
        "If edge tests fail: redeploy the `persist-vital` function so it includes `model_inference.json` and the latest `index.ts`.",
    );
  }
  process.exit(failures > 0 ? 1 : 0);
}

main();
