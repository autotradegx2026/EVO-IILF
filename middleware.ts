// middleware.ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { isPersonalAccount } from '@/lib/supabase/personal-access'

const PUBLIC_PATHS = ['/login', '/register', '/auth/callback', '/api/webhook', '/api/webhook/paper', '/api/jobs/alerts', '/api/jobs/strategy', '/api/jobs/paper', '/api/jobs/execution']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Protected pages always require authentication.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.next()
  }
  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next()
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon')) return NextResponse.next()

  try {
    // Official Supabase SSR middleware pattern
    let supabaseResponse = NextResponse.next({ request })

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
            supabaseResponse = NextResponse.next({ request })
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options)
            )
          },
        },
      }
    )

    const { data: { user } } = await Promise.race([
      supabase.auth.getUser(),
      new Promise<{ data: { user: null } }>(resolve =>
        setTimeout(() => resolve({ data: { user: null } }), 4000)
      ),
    ])

    if (!user) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
      }
      const loginUrl = request.nextUrl.clone()
      loginUrl.pathname = '/login'
      return NextResponse.redirect(loginUrl)
    }

    if (!isPersonalAccount(user.email)) {
      if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'ACCOUNT_NOT_ALLOWED' }, { status: 403 })
      return NextResponse.redirect(new URL('/login?error=account_not_allowed', request.url))
    }

    return supabaseResponse
  } catch {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'AUTH_UNAVAILABLE', code: 'AUTH_UNAVAILABLE' }, { status: 503 })
    // If Supabase auth check fails, redirect to login rather than crashing
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    return NextResponse.redirect(loginUrl)
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/webhook).*)',
  ],
}
