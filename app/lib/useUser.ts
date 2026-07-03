"use client";

import { useEffect, useState } from "react";
import { createClient } from "./supabase/client";

export type SimpleUser = { id: string; email: string | null };

// 현재 로그인 사용자(없으면 null). Supabase 미설정 환경에서도 안전하게 동작.
export function useUser() {
  const [user, setUser] = useState<SimpleUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ) {
      setReady(true);
      return;
    }
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setUser(
        data.user ? { id: data.user.id, email: data.user.email ?? null } : null,
      );
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(
        session?.user
          ? { id: session.user.id, email: session.user.email ?? null }
          : null,
      );
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { user, ready };
}
