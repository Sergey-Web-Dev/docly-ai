import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';

const AUTH_PAGES = ['/login', '/signup'];

export async function proxy(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers?: Record<string, string>) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const isSignedIn = Boolean(data?.claims);
  const { pathname } = request.nextUrl;

  if (!isSignedIn && pathname.startsWith('/dashboard')) return redirectWithCookies(request, '/login', response);
  if (isSignedIn && AUTH_PAGES.includes(pathname)) return redirectWithCookies(request, '/dashboard', response);
  return response;
}

function redirectWithCookies(request: NextRequest, path: string, from: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(new URL(path, request.url));
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|widget.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
