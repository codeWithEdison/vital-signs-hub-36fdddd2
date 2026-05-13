import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type HealthStatus =
  | "SAFE"
  | "OBSERVE"
  | "WARNING"
  | "ALERT"
  | "CRITICAL"
  | "INVALID";

interface ModelWeights {
  classes: string[];
  feature_names: string[];
  scaler_mean: number[];
  scaler_scale: number[];
  coef: number[][];
  intercept: number[];
}

const weights: ModelWeights = JSON.parse(
  Deno.readTextFileSync(new URL("./model_inference.json", import.meta.url)),
);

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function evaluateHealth(
  temperature: number,
  heart_rate: number,
  spo2: number,
): { status: HealthStatus; recommendation: string } {
  const invalidReading =
    !Number.isFinite(temperature) ||
    !Number.isFinite(heart_rate) ||
    !Number.isFinite(spo2) ||
    temperature < 30 ||
    temperature > 45 ||
    heart_rate < 30 ||
    heart_rate > 220 ||
    spo2 < 70 ||
    spo2 > 100;

  if (invalidReading) {
    return {
      status: "INVALID",
      recommendation: "Invalid sensor reading. Please retake measurement",
    };
  }

  if (spo2 < 90 || temperature >= 39.5 || heart_rate >= 140) {
    return {
      status: "CRITICAL",
      recommendation: "Seek emergency care immediately",
    };
  }
  if (temperature > 38 || spo2 < 94) {
    return {
      status: "ALERT",
      recommendation: "Visit the clinic immediately",
    };
  }
  if (heart_rate > 100) {
    return {
      status: "WARNING",
      recommendation: "Rest and monitor your condition",
    };
  }
  if (
    (temperature >= 37.3 && temperature <= 38.0) ||
    (heart_rate >= 95 && heart_rate <= 100) ||
    (spo2 >= 94 && spo2 <= 95)
  ) {
    return {
      status: "OBSERVE",
      recommendation: "Recheck your vitals soon and continue observing",
    };
  }
  return {
    status: "SAFE",
    recommendation: "You are in good health",
  };
}

function softmax(logits: number[]): number[] {
  const m = Math.max(...logits);
  const ex = logits.map((z) => Math.exp(z - m));
  const s = ex.reduce((a, b) => a + b, 0);
  return ex.map((e) => e / s);
}

function predictModelStatus(
  temperature: number,
  heart_rate: number,
  spo2: number,
): { model_status: string; model_confidence: number } {
  const m = weights.scaler_mean;
  const s = weights.scaler_scale;
  const z = [
    (temperature - m[0]) / s[0],
    (heart_rate - m[1]) / s[1],
    (spo2 - m[2]) / s[2],
  ];
  const logits = weights.coef.map((row, k) =>
    row[0] * z[0] + row[1] * z[1] + row[2] * z[2] + weights.intercept[k],
  );
  const probs = softmax(logits);
  let best = 0;
  for (let i = 1; i < probs.length; i++) {
    if (probs[i] > probs[best]) best = i;
  }
  return {
    model_status: weights.classes[best],
    model_confidence: probs[best],
  };
}

function predictHybrid(temperature: number, heart_rate: number, spo2: number) {
  const rule = evaluateHealth(temperature, heart_rate, spo2);
  const { model_status, model_confidence } = predictModelStatus(
    temperature,
    heart_rate,
    spo2,
  );

  let final_status: string;
  let decision_source: string;
  if (rule.status === "INVALID" || rule.status === "CRITICAL" || rule.status === "ALERT") {
    final_status = rule.status;
    decision_source = "rule_override";
  } else {
    final_status = model_status;
    decision_source = "model";
  }

  return {
    input: { temperature, heart_rate, spo2 },
    rule_status: rule.status,
    model_status,
    model_confidence,
    final_status,
    decision_source,
    recommendation: rule.recommendation,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) {
      return new Response(
        JSON.stringify({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as {
      vital_id?: string;
      temperature?: number;
      heart_rate?: number;
      spo2?: number;
    };

    const vital_id = body.vital_id;
    const temperature = body.temperature;
    const heart_rate = body.heart_rate;
    const spo2 = body.spo2;

    if (
      typeof vital_id !== "string" ||
      typeof temperature !== "number" ||
      typeof heart_rate !== "number" ||
      typeof spo2 !== "number"
    ) {
      return new Response(
        JSON.stringify({
          error: "Expected JSON: { vital_id: string, temperature, heart_rate, spo2: numbers }",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const result = predictHybrid(temperature, heart_rate, spo2);

    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const updatePayload = {
      model_status: result.model_status,
      final_status: result.final_status,
      model_confidence: result.model_confidence,
      decision_source: result.decision_source,
      recommendation: result.recommendation,
      status: result.final_status,
      model_updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("vitals")
      .update(updatePayload)
      .eq("id", vital_id)
      .select("id");

    if (error) {
      console.error("Supabase update error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!data?.length) {
      return new Response(JSON.stringify({ error: `Vital not found: ${vital_id}` }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ vital_id, ...result }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
