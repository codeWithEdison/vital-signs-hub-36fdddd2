// Persists model prediction results to public.vitals.
// Uses SUPABASE_SERVICE_ROLE_KEY (auto-injected by Lovable Cloud) so the
// service role key never has to live on a developer's laptop.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface PersistPayload {
  vital_id: string;
  model_status: string;
  final_status: string;
  model_confidence: number;
  decision_source: string;
  recommendation: string;
}

function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

function validate(body: unknown): { ok: true; data: PersistPayload } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Body must be JSON object" };
  const b = body as Record<string, unknown>;
  if (!isUuid(b.vital_id)) return { ok: false, error: "vital_id must be a UUID" };
  for (const k of ["model_status", "final_status", "decision_source", "recommendation"]) {
    if (typeof b[k] !== "string" || !(b[k] as string).length) {
      return { ok: false, error: `${k} must be a non-empty string` };
    }
  }
  if (typeof b.model_confidence !== "number" || Number.isNaN(b.model_confidence)) {
    return { ok: false, error: "model_confidence must be a number" };
  }
  return { ok: true, data: b as unknown as PersistPayload };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const v = validate(body);
  if (!v.ok) {
    return new Response(JSON.stringify({ error: v.error }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return new Response(
      JSON.stringify({ error: "Backend not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  const { data, error } = await sb
    .from("vitals")
    .update({
      model_status: v.data.model_status,
      final_status: v.data.final_status,
      model_confidence: v.data.model_confidence,
      decision_source: v.data.decision_source,
      recommendation: v.data.recommendation,
      status: v.data.final_status,
      model_updated_at: new Date().toISOString(),
    })
    .eq("id", v.data.vital_id)
    .select("id");

  if (error) {
    console.error("vitals update failed", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!data || data.length === 0) {
    return new Response(
      JSON.stringify({ error: `Vital not found: ${v.data.vital_id}` }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  return new Response(JSON.stringify({ ok: true, vital_id: v.data.vital_id }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
