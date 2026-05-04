import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const supabaseUrl = 'https://bkgdrfyjppjxwnwntcbc.supabase.co';
const supabaseAnonKey = 'sb_publishable_fMbQ-x2q2q5XA_pT4Bpf6w_ZMcbCQen';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true
    }
});
