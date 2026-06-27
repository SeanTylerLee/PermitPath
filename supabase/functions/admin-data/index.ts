/**
 * Edge Function: admin-data
 *
 * Routes (same function, path suffix):
 *   GET  /functions/v1/admin-data/stats
 *   GET  /functions/v1/admin-data/profiles?email=&subscription_active=&limit=&offset=
 *   GET  /functions/v1/admin-data/usage-events?from=&to=&event_type=&user_id=&limit=&offset=
 *   GET  /functions/v1/admin-data/deleted-accounts?deletion_source=&limit=&offset=
 *   POST /functions/v1/admin-data/delete-user   body: { "user_id": "<uuid>" }
 *
 * Security: resolves caller via JWT (Authorization: Bearer <access_token>),
 * compares auth.users id to ADMIN_USER_ID, then uses service role for reads/writes.
 *
 * CORS: echo allowed Origins (production + localhost with any port for dev).
 *
 * App RPCs (iOS): log_app_open, log_route_built, log_navigation_started,
 * sync_subscription_state, delete_own_account (self-delete; logs account_deletions then cascades).
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const DEFAULT_ADMIN_USER_ID = 'ee962eec-a890-4ce8-9dcc-b9b30d241008';

const PROFILE_SELECT =
    'id, user_id, full_name, email, app_account_token, routes_built_count, subscription_is_active, subscription_product_id, subscription_expires_at, subscription_will_auto_renew, original_transaction_id, created_at, updated_at, last_seen_at';

const USAGE_EVENT_SELECT = 'id, user_id, event_type, created_at, metadata';

const DELETION_SELECT =
    'id, user_id, email, full_name, routes_built_count, subscription_is_active, subscription_product_id, subscription_expires_at, profile_created_at, last_seen_at, deleted_at, deletion_source';

const KNOWN_EVENT_TYPES = [
    'app_open',
    'route_built',
    'navigation_started',
    'subscription_snapshot'
] as const;

const SPECIFIC_ORIGINS = new Set([
    'https://permitpathnav.com',
    'https://www.permitpathnav.com',
    'http://localhost',
    'http://127.0.0.1'
]);

function originAllowed(origin: string | null): string {
    if (!origin || origin === 'null') return '*';
    if (SPECIFIC_ORIGINS.has(origin)) return origin;
    try {
        const u = new URL(origin);
        const host = u.hostname.toLowerCase();
        if (host === 'permitpathnav.com' || host === 'www.permitpathnav.com') {
            return origin;
        }
        if (host === 'localhost' || host === '127.0.0.1') {
            return origin;
        }
    } catch {
        /* ignore */
    }
    return '*';
}

function corsHeadersFor(req: Request): Record<string, string> {
    const allowOrigin = originAllowed(req.headers.get('Origin'));
    const h: Record<string, string> = {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
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

    const m1 = p.match(/^\/functions\/v1\/admin-data\/([^/]+)$/);
    if (m1) return decodeURIComponent(m1[1]);

    const m2 = p.match(/^\/admin-data\/([^/]+)$/);
    if (m2) return decodeURIComponent(m2[1]);

    const m3 = p.match(/^\/([^/]+)$/);
    if (m3) return decodeURIComponent(m3[1]);

    return null;
}

function parseLimit(raw: string | null, defaultLimit = 500, maxLimit = 2000): number {
    const n = parseInt(raw ?? '', 10);
    if (!Number.isFinite(n) || n <= 0) return defaultLimit;
    return Math.min(n, maxLimit);
}

function parseOffset(raw: string | null): number {
    const n = parseInt(raw ?? '', 10);
    if (!Number.isFinite(n) || n < 0) return 0;
    return n;
}

function isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value
    );
}

function parseSubscriptionActive(raw: string | null): boolean | null {
    if (!raw) return null;
    const v = raw.trim().toLowerCase();
    if (v === 'true' || v === '1' || v === 'yes') return true;
    if (v === 'false' || v === '0' || v === 'no') return false;
    return null;
}

type DeletionSource = 'self' | 'admin';

async function logAccountDeletion(
    supabaseAdmin: SupabaseClient,
    userId: string,
    source: DeletionSource
): Promise<{ error: string | null }> {
    const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select(
            'email, full_name, routes_built_count, subscription_is_active, subscription_product_id, subscription_expires_at, created_at, last_seen_at'
        )
        .or(`id.eq.${userId},user_id.eq.${userId}`)
        .maybeSingle();

    if (profileError) {
        return { error: profileError.message };
    }

    let email = profile?.email ?? null;
    if (!email) {
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.getUserById(userId);
        if (authError) {
            return { error: authError.message };
        }
        email = authData?.user?.email ?? null;
    }

    const { error: insertError } = await supabaseAdmin.from('account_deletions').insert({
        user_id: userId,
        email,
        full_name: profile?.full_name ?? null,
        routes_built_count: profile?.routes_built_count ?? 0,
        subscription_is_active: profile?.subscription_is_active ?? false,
        subscription_product_id: profile?.subscription_product_id ?? null,
        subscription_expires_at: profile?.subscription_expires_at ?? null,
        profile_created_at: profile?.created_at ?? null,
        last_seen_at: profile?.last_seen_at ?? null,
        deletion_source: source
    });

    if (insertError) {
        return { error: insertError.message };
    }

    return { error: null };
}

Deno.serve(async (req) => {
    const cors = corsHeadersFor(req);

    const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
            status,
            headers: { ...cors, 'Content-Type': 'application/json' }
        });

    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: cors, status: 200 });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const adminUserId = Deno.env.get('ADMIN_USER_ID') || DEFAULT_ADMIN_USER_ID;

    if (!supabaseUrl || !anonKey || !serviceKey) {
        console.error(
            'admin-data: missing SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY'
        );
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
        if (route === 'stats' && req.method === 'GET') {
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

            const { count: totalProfiles, error: profileCountError } = await supabaseAdmin
                .from('profiles')
                .select('*', { count: 'exact', head: true });

            if (profileCountError) {
                return json({ error: profileCountError.message }, 500);
            }

            const { count: activeSubscriptions, error: activeSubError } = await supabaseAdmin
                .from('profiles')
                .select('*', { count: 'exact', head: true })
                .eq('subscription_is_active', true);

            if (activeSubError) {
                return json({ error: activeSubError.message }, 500);
            }

            const { data: routeRows, error: routesError } = await supabaseAdmin
                .from('profiles')
                .select('routes_built_count');

            if (routesError) {
                return json({ error: routesError.message }, 500);
            }

            const totalRoutesBuilt = (routeRows ?? []).reduce(
                (sum, row) => sum + (row.routes_built_count ?? 0),
                0
            );

            const eventsLast30Days: Record<string, number> = {};
            for (const eventType of KNOWN_EVENT_TYPES) {
                const { count, error } = await supabaseAdmin
                    .from('usage_events')
                    .select('*', { count: 'exact', head: true })
                    .eq('event_type', eventType)
                    .gte('created_at', thirtyDaysAgo);

                if (error) {
                    return json({ error: error.message }, 500);
                }
                eventsLast30Days[eventType] = count ?? 0;
            }

            const { count: selfDeletions, error: selfDelError } = await supabaseAdmin
                .from('account_deletions')
                .select('*', { count: 'exact', head: true })
                .eq('deletion_source', 'self');

            if (selfDelError) {
                return json({ error: selfDelError.message }, 500);
            }

            return json({
                total_profiles: totalProfiles ?? 0,
                active_subscriptions: activeSubscriptions ?? 0,
                total_routes_built: totalRoutesBuilt,
                self_deletions: selfDeletions ?? 0,
                events_last_30_days: eventsLast30Days,
                known_event_types: KNOWN_EVENT_TYPES,
                generated_at: new Date().toISOString()
            });
        }

        if (route === 'profiles' && req.method === 'GET') {
            const email = url.searchParams.get('email')?.trim();
            const subscriptionActive = parseSubscriptionActive(
                url.searchParams.get('subscription_active')
            );
            const limitParam = url.searchParams.get('limit');
            const offset = parseOffset(url.searchParams.get('offset'));

            let q = supabaseAdmin
                .from('profiles')
                .select(PROFILE_SELECT, { count: 'exact' })
                .order('last_seen_at', { ascending: false, nullsFirst: false })
                .order('created_at', { ascending: false });

            if (limitParam !== null && limitParam !== '') {
                const limit = parseLimit(limitParam, 500, 2000);
                q = q.range(offset, offset + limit - 1);
            }

            if (email) {
                q = q.ilike('email', `%${email}%`);
            }
            if (subscriptionActive !== null) {
                q = q.eq('subscription_is_active', subscriptionActive);
            }

            const { data: profiles, error, count: total } = await q;

            if (error) {
                console.error('admin-data profiles query:', error.message);
                return json({ error: error.message }, 500);
            }

            return json({
                profiles: profiles ?? [],
                offset,
                count: (profiles ?? []).length,
                total: total ?? (profiles ?? []).length
            });
        }

        if (route === 'usage-events' && req.method === 'GET') {
            const from = url.searchParams.get('from');
            const to = url.searchParams.get('to');
            const eventType = url.searchParams.get('event_type');
            const userId = url.searchParams.get('user_id');
            const limitParam = url.searchParams.get('limit');
            const offset = parseOffset(url.searchParams.get('offset'));

            if (userId && !isUuid(userId)) {
                return json({ error: 'Invalid user_id' }, 400);
            }

            let fromIso = from;
            if (!fromIso && !to) {
                const windowStart = new Date();
                windowStart.setUTCDate(windowStart.getUTCDate() - 90);
                fromIso = windowStart.toISOString();
            }

            let q = supabaseAdmin
                .from('usage_events')
                .select(USAGE_EVENT_SELECT, { count: 'exact' })
                .order('created_at', { ascending: false });

            if (limitParam !== null && limitParam !== '') {
                const limit = parseLimit(limitParam, 500, 2000);
                q = q.range(offset, offset + limit - 1);
            }

            if (fromIso) q = q.gte('created_at', fromIso);
            if (to) q = q.lte('created_at', to);
            if (eventType) q = q.eq('event_type', eventType);
            if (userId) q = q.eq('user_id', userId);

            const { data: usage_events, error, count: total } = await q;

            if (error) {
                console.error('admin-data usage_events query:', error.message);
                return json({ error: error.message }, 500);
            }

            return json({
                usage_events: usage_events ?? [],
                window_days: fromIso && !from ? 90 : null,
                from: fromIso ?? null,
                to: to ?? null,
                offset,
                count: (usage_events ?? []).length,
                total: total ?? (usage_events ?? []).length,
                known_event_types: KNOWN_EVENT_TYPES
            });
        }

        if (route === 'deleted-accounts' && req.method === 'GET') {
            const source = url.searchParams.get('deletion_source')?.trim().toLowerCase();
            const limit = parseLimit(url.searchParams.get('limit'), 500, 2000);
            const offset = parseOffset(url.searchParams.get('offset'));

            if (source && source !== 'self' && source !== 'admin') {
                return json({ error: 'Invalid deletion_source (use self or admin)' }, 400);
            }

            let q = supabaseAdmin
                .from('account_deletions')
                .select(DELETION_SELECT, { count: 'exact' })
                .order('deleted_at', { ascending: false })
                .range(offset, offset + limit - 1);

            if (source === 'self' || source === 'admin') {
                q = q.eq('deletion_source', source);
            }

            const { data: deleted_accounts, error, count: total } = await q;

            if (error) {
                console.error('admin-data deleted-accounts query:', error.message);
                return json({ error: error.message }, 500);
            }

            return json({
                deleted_accounts: deleted_accounts ?? [],
                limit,
                offset,
                count: (deleted_accounts ?? []).length,
                total: total ?? (deleted_accounts ?? []).length
            });
        }

        if (route === 'delete-user' && req.method === 'POST') {
            let body: { user_id?: string } = {};
            try {
                body = await req.json();
            } catch {
                return json({ error: 'Invalid JSON body' }, 400);
            }

            const targetUserId = body.user_id?.trim();
            if (!targetUserId || !isUuid(targetUserId)) {
                return json({ error: 'Missing or invalid user_id' }, 400);
            }

            if (targetUserId === adminUserId) {
                return json({ error: 'Cannot delete the admin account' }, 400);
            }

            const logResult = await logAccountDeletion(supabaseAdmin, targetUserId, 'admin');
            if (logResult.error) {
                console.error('admin-data delete-user log:', logResult.error);
                return json({ error: logResult.error }, 500);
            }

            const { error } = await supabaseAdmin.auth.admin.deleteUser(targetUserId);

            if (error) {
                console.error('admin-data delete-user:', error.message);
                return json({ error: error.message }, 500);
            }

            return json({ ok: true, deleted_user_id: targetUserId });
        }

        if (req.method === 'GET') {
            return json({ error: 'Not found' }, 404);
        }

        return json({ error: 'Method not allowed' }, 405);
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unexpected error';
        console.error('admin-data:', msg);
        return json({ error: msg }, 500);
    }
});
