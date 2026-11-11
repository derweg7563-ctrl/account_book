import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Supabase URL과 API Key가 설정되어 있지 않습니다.");
}

export const supabase = createClient(supabaseUrl, supabaseKey);

export type Expense = {
  id: number;
  created_at: string;
  date: string;
  amount: number;
  description: string;
};
