// Mellanstation för AI-assistenten i budgetappen (Supabase Edge Function).
//
// Appen är publik, så API-nyckeln till Claude får inte ligga i den. Nyckeln ligger
// här som en hemlighet (ANTHROPIC_API_KEY) och bara inloggade konton vars e-post
// står i ALLOWED_EMAILS får använda den. Funktionen skickar vidare en fråga i taget
// till Claude och returnerar svaret; verktygen körs i appen, på din egen data.
//
// Hemligheter som ställs in i Supabase (Edge Functions -> Secrets):
//   ANTHROPIC_API_KEY  din nyckel från console.anthropic.com
//   ALLOWED_EMAILS     e-postadresser som får använda assistenten, kommaseparerade
// SUPABASE_URL och SUPABASE_ANON_KEY finns redan automatiskt.

import Anthropic from "npm:@anthropic-ai/sdk@1.8.0";
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const MODEL = "claude-opus-5-5";
const MAX_MESSAGES = 80;          // längsta konversation som tas emot
const MAX_BODY_BYTES = 400_000;   // skydd mot onormalt stora anrop

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const anthropic = new Anthropic(); // läser ANTHROPIC_API_KEY

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // ---------- Vem frågar? ----------
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "not_signed_in" }, 401);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data: auth, error: authError } = await supabase.auth.getUser(token);
  if (authError || !auth?.user?.email) return json({ error: "not_signed_in" }, 401);
  const allowed = (Deno.env.get("ALLOWED_EMAILS") || "")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(auth.user.email.toLowerCase())) return json({ error: "not_allowed" }, 403);
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return json({ error: "no_api_key" }, 500);

  // ---------- Vad frågas? ----------
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "too_large" }, 413);
  let body: { system?: unknown; tools?: unknown; messages?: unknown };
  try { body = JSON.parse(raw); } catch { return json({ error: "bad_json" }, 400); }
  const { system, tools, messages } = body;
  if (typeof system !== "string" || !Array.isArray(tools) || !Array.isArray(messages)) {
    return json({ error: "bad_request" }, 400);
  }
  if (messages.length === 0 || messages.length > MAX_MESSAGES) return json({ error: "too_long" }, 400);

  // ---------- Fråga Claude ----------
  try {
    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // Chatt behöver inte djup eftertanke: låg ansträngning ger snabbare och billigare svar
      output_config: { effort: "low" },
      // Tackar modellen nej av säkerhetsskäl tar en annan modell över i samma anrop
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // Instruktioner och verktyg är desamma varje gång: cachas, så att varje fråga blir billigare
      cache_control: { type: "ephemeral" },
      system,
      tools: tools as Anthropic.Beta.BetaToolUnion[],
      messages: messages as Anthropic.Beta.BetaMessageParam[],
    });
    return json(response);
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return json({ error: "bad_api_key" }, 500);
    if (error instanceof Anthropic.PermissionDeniedError) return json({ error: "bad_api_key" }, 500);
    if (error instanceof Anthropic.RateLimitError) return json({ error: "rate_limited" }, 429);
    if (error instanceof Anthropic.BadRequestError) return json({ error: "bad_request", detail: error.message }, 400);
    if (error instanceof Anthropic.APIError) return json({ error: "api_error", detail: error.message }, 502);
    return json({ error: "server_error", detail: String(error) }, 500);
  }
});
