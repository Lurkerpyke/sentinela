import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublicKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY

console.log('Supabase URL:', supabaseUrl)
console.log('Supabase key configurada:', Boolean(supabasePublicKey))


export const supabaseConfigured = Boolean(supabaseUrl && supabasePublicKey)
export const supabase = supabaseConfigured
    ? createClient(supabaseUrl, supabasePublicKey, {
        auth: {
            autoRefreshToken: true,
            detectSessionInUrl: true,
            persistSession: true,
        },
    })
    : null
