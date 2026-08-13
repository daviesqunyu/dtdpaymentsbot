const SUPABASE_URL = "https://iqoffsnkptulvuqmdcce.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlxb2Zmc25rcHR1bHZ1cW1kY2NlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMDY4MzUsImV4cCI6MjA5Nzc4MjgzNX0.Zde1VaB2IAtBbeb9mcPXPSi9ZoMA-0A2ika_JEvIuLs";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.supabaseClient = supabaseClient;
