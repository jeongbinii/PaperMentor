import { NextResponse } from "next/server";
import { createClient } from "@/app/lib/supabase/server";

// 로그아웃: 세션 종료 후 홈으로. (form POST에서 호출 → 303으로 GET 리다이렉트)
export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const { origin } = new URL(request.url);
  return NextResponse.redirect(`${origin}/`, { status: 303 });
}
