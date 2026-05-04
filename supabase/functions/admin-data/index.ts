/**
 * Edge Function: admin-data
 *
 * Routes (same function, path suffix):
 *   GET /functions/v1/admin-data/profiles
 *   GET /functions/v1/admin-data/usage-events?from=&to=&event_type=
 *
 * Security: resolves caller via JWT (Authorization: Bearer <access_token>),
 * compares auth.users id to ADMIN_USER_ID, then uses service role for reads.
 *
 * RLS: service role bypasses RLS. Do not expose service key to clients; only this
 * function runs with it after the admin check. If you add direct client reads on
 * these tables, add RLS policies keyed on auth.uid() and an admin flag/role.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    // Include POST defensively (preflight / proxies); handler only implements GET.
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

const DEFAULT_ADMIN_USER_ID = 'ee962eec-a890-4ce8-9dcc-b9b30d241008';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
}

function routeFromUrl(url: URL): string | null {
    const m = url.pathname.match(/\/functions\/v1\/admin-data\/([^/]+)\/?$/);
    return m ? decodeURIComponent(m[1]) : null;
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    if (req.method !== 'GET') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const adminUserId = Deno.env.get('ADMIN_USER_ID') || DEFAULT_ADMIN_USER_ID;

    if (!supabaseUrl || !anonKey || !serviceKey) {
        console.error('admin-data: missing SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY');
        return jsonResponse({ error: 'Server misconfiguration' }, 500);
    }

    const authHeader = req.headers.get('Authorization') || '';
    const hasBearer = /^Bearer\s+\S+$/i.test(authHeader.trim());

    if (!hasBearer) {
        return jsonResponse({ error: 'Missing or invalid Authorization header' }, 401);
    }

    const supabaseUser = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } }
    });

    const {
        data: { user },
        error: userError
    } = await supabaseUser.auth.getUser();

    if (userError || !user) {
        return jsonResponse({ error: 'Invalid session' }, 401);
    }

    if (user.id !== adminUserId) {
        return jsonResponse({ error: 'Forbidden' }, 403);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false }
    });

    const url = new URL(req.url);
    const route = routeFromUrl(url);

    if (!route) {
        return jsonResponse({ error: 'Not found' }, 404);
    }

    try {
        if (route === 'profiles') {
            const { data: profiles, error } = await supabaseAdmin
                .from('profiles')
                .select('id, user_id, full_name, email, routes_built_count, subscription_is_active');

            if (error) {
                console.error('admin-data profiles query:', error.message);
                return jsonResponse({ error: error.message }, 500);
            }

            return jsonResponse({ profiles: profiles ?? [] });
        }

        if (route === 'usage-events') {
            const from = url.searchParams.get('from');
            const to = url.searchParams.get('to');
            const eventType = url.searchParams.get('event_type');

            let q = supabaseAdmin
                .from('usage_events')
                .select('event_type, created_at, metadata')
                .order('created_at', { ascending: false });

            if (from) q = q.gte('created_at', from);
            if (to) q = q.lte('created_at', to);
            if (eventType) q = q.eq('event_type', eventType);

            const { data: usage_events, error } = await q;

            if (error) {
                console.error('admin-data usage_events query:', error.message);
                return jsonResponse({ error: error.message }, 500);
            }

            return jsonResponse({ usage_events: usage_events ?? [] });
        }

        return jsonResponse({ error: 'Not found' }, 404);
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unexpected error';
        console.error('admin-data:', msg);
        return jsonResponse({ error: msg }, 500);
    }
});
