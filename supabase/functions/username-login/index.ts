import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: cors });
  }

  try {
    const { username, password } = await request.json();
    const handle = String(username || "").replace(/^@/, "").trim().toLowerCase();
    if (!/^[a-z0-9_][a-z0-9_-]{1,19}$/.test(handle) || !password) {
      return Response.json({ error: "ユーザー名かパスワードが違います" }, { status: 400, headers: cors });
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    const { data: profile } = await admin.from("profiles").select("id").ilike("handle", handle).maybeSingle();
    if (!profile?.id) {
      return Response.json({ error: "ユーザー名かパスワードが違います" }, { status: 401, headers: cors });
    }
    const { data: authData } = await admin.auth.admin.getUserById(profile.id);
    const email = authData?.user?.email;
    if (!email) {
      return Response.json({ error: "ユーザー名かパスワードが違います" }, { status: 401, headers: cors });
    }

    const auth = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data, error } = await auth.auth.signInWithPassword({ email, password: String(password) });
    if (error || !data.session) {
      return Response.json({ error: "ユーザー名かパスワードが違います" }, { status: 401, headers: cors });
    }
    return Response.json(data.session, { headers: { ...cors, "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "ログイン処理に失敗しました" }, { status: 500, headers: cors });
  }
});
