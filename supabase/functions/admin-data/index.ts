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
 * CORS: Safari is strict — echo a known Origin (your site) instead of relying on * alone.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const DEFAULT_ADMIN_USER_ID = 'ee962eec-a890-4ce8-9dcc-b9b30d241008';

function originAllowed(origin: string | null): string {
    if (!origin || origin === 'null') return '*';
    try {
        const u = new URL(origin);
        const host = u.hostname.toLowerCase();
        if (host === 'permitpathnav.com' || host === 'www.permitpathnav.com') {
            return origin;
        }
        if (host === 'localhost' || host === '127.0.0.1') {
            return origin;
        }
    } catch (_e) {
        /* ignore */
    }
    return '*';
}

function corsHeadersFor(req: Request): Record<string, string> {
    const allowOrigin = originAllowed(req.headers.get('Origin'));
    const h: Record<string, string> = {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    };
    if (allowOrigin !== '*') {
        h['Vary'] = 'Origin';
    }
    return h;
}

function routeFromUrl(url: URL): string | null {
    const p = (url.pathname || '').replace(/\/+$/, '');
    if (!p) return null;

    // Supabase runtimes can expose different path shapes depending on gateway/proxy:
    // - /profiles
    // - /admin-data/profiles
    // - /functions/v1/admin-data/profiles
    const m1 = p.match(/^\/functions\/v1\/admin-data\/([^/]+)$/);
    if (m1) return decodeURIComponent(m1[1]);

    const m2 = p.match(/^\/admin-data\/([^/]+)$/);
    if (m2) return decodeURIComponent(m2[1]);

    const m3 = p.match(/^\/([^/]+)$/);
    if (m3) return decodeURIComponent(m3[1]);

    return null;
}

Deno.serve(async (req) => {
    const cors = corsHeadersFor(req);

    const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
            status,
            headers: { ...cors, 'Content-Type': 'application/json' }
        });

    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: cors });
    }

    if (req.method !== 'GET') {
        return json({ error: 'Method not allowed' }, 405);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const adminUserId = Deno.env.get('ADMIN_USER_ID') || DEFAULT_ADMIN_USER_ID;

    if (!supabaseUrl || !anonKey || !serviceKey) {
        console.error('admin-data: missing SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY');
        return json({ error: 'Server misconfiguration' }, 500);
    }

    const authHeader = req.headers.get('Authorization') || '';
    const hasBearer = /^Bearer\s+\S+$/i.test(authHeader.trim());

    if (!hasBearer) {
        return json({ error: 'Missing or invalid Authorization header' }, 401);
    }

    const supabaseUser = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } }
    });

    const {
        data: { user },
        error: userError
    } = await supabaseUser.auth.getUser();

    if (userError || !user) {
        return json({ error: 'Invalid session' }, 401);
    }

    if (user.id !== adminUserId) {
        return json({ error: 'Forbidden' }, 403);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false }
    });

    const url = new URL(req.url);
    const route = routeFromUrl(url);

    if (!route) {
        return json({ error: 'Not found' }, 404);
    }

    try {
        if (route === 'profiles') {
            const { data: profiles, error } = await supabaseAdmin
                .from('profiles')
                .select(
                    'id, user_id, full_name, email, routes_built_count, subscription_is_active, created_at, last_seen_at, subscription_product_id, subscription_expires_at'
                );

            if (error) {
                console.error('admin-data profiles query:', error.message);
                return json({ error: error.message }, 500);
            }

            return json({ profiles: profiles ?? [] });
        }

        if (route === 'usage-events') {
            const from = url.searchParams.get('from');
            const to = url.searchParams.get('to');
            const eventType = url.searchParams.get('event_type');

            let q = supabaseAdmin
                .from('usage_events')
                .select('user_id, event_type, created_at, metadata')
                .order('created_at', { ascending: false });

            if (from) q = q.gte('created_at', from);
            if (to) q = q.lte('created_at', to);
            if (eventType) q = q.eq('event_type', eventType);

            const { data: usage_events, error } = await q;

            if (error) {
                console.error('admin-data usage_events query:', error.message);
                return json({ error: error.message }, 500);
            }

            return json({ usage_events: usage_events ?? [] });
        }

        return json({ error: 'Not found' }, 404);
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unexpected error';
        console.error('admin-data:', msg);
        return json({ error: msg }, 500);
    }
});
