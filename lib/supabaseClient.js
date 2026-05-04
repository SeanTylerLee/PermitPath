import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

export const supabaseUrl = 'https://bkgdrfyjppjxwnwntcbc.supabase.co';
/** Public client key (anon / publishable); needed for Edge Function fetch `apikey` header. */
export const supabaseAnonKey = 'sb_publishable_fMbQ-x2q2q5XA_pT4Bpf6w_ZMcbCQen';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        // Must be false for email reset links: PKCE ?code=... requires a code_verifier that only
        // exists in the browser that started the flow. App-initiated resets have no verifier here.
        detectSessionInUrl: false,
        persistSession: true,
        autoRefreshToken: true
    }
});
