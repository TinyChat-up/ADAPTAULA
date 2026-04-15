import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";

export type AuthCredentials = {
  email: string;
  password: string;
};

export async function getCurrentUser(): Promise<User | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user ?? null;
}

export async function signInWithPassword(credentials: AuthCredentials) {
  const { data, error } = await supabase.auth.signInWithPassword(credentials);
  if (error) throw error;
  return data;
}

export async function signUpWithPassword(credentials: AuthCredentials) {
  const { data, error } = await supabase.auth.signUp(credentials);
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export function onAuthStateChange(
  callback: (event: string, user: User | null) => void,
) {
  return supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session?.user ?? null);
  });
}
