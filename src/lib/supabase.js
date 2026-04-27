// Supabase client for Rungles. Same project as Wordy — accounts are shared.
// The anon key is public-by-design (browser-bundled); RLS protects data.

import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = 'https://yyhewndblruwxsrqzart.supabase.co'
export const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON)
