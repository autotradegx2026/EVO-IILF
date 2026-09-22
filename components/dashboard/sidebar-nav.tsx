'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, ScanLine, ChartCandlestick, SlidersHorizontal, PlugZap, Workflow, BookOpen, ChartNoAxesCombined, Bell, ShieldCheck, FlaskConical, UserRound, LogOut, Activity } from 'lucide-react'
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarSeparator, useSidebar } from '@/components/ui/sidebar'

export const NAV_GROUPS = [
  { label: 'Workspace', items: [
    { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/screener', label: 'Strategy & Screener', icon: ScanLine },
    { href: '/charts', label: 'Charts', icon: ChartCandlestick },
    { href: '/backtest', label: 'Paper Trade', icon: FlaskConical },
  ] },
  { label: 'Trading', items: [
    { href: '/broker', label: 'Broker APIs', icon: PlugZap },
    { href: '/automation', label: 'Broker Orders', icon: Workflow },
    { href: '/risk', label: 'Risk & Controls', icon: ShieldCheck },
  ] },
  { label: 'Insights', items: [
    { href: '/journal', label: 'Journal', icon: BookOpen },
    { href: '/analytics', label: 'Analytics', icon: ChartNoAxesCombined },
    { href: '/alerts', label: 'Alerts', icon: Bell },
  ] },
]

export function SidebarNav({ userEmail }: { userEmail: string }) {
  const pathname = usePathname()
  const { setOpenMobile } = useSidebar()
  const navigate = () => setOpenMobile(false)
  return <Sidebar variant="floating" collapsible="icon" aria-label="Main navigation">
    <SidebarHeader className="p-3 group-data-[collapsible=icon]:p-2">
      <Link href="/" onClick={navigate} aria-label="AutotradeX home" className="flex h-12 items-center gap-3 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex size-9 group-data-[collapsible=icon]:size-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm"><Activity className="size-5" /></span>
        <span className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden"><span className="text-base font-bold tracking-tight text-foreground">AutotradeX</span><span className="truncate text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Personal workspace</span></span>
      </Link>
    </SidebarHeader>
    <SidebarSeparator />
    <SidebarContent>
      <nav aria-label="Workspace pages" className="w-full min-w-0">
        {NAV_GROUPS.map(group => <SidebarGroup key={group.label}>
          <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
          <SidebarGroupContent><SidebarMenu>{group.items.map(item => <SidebarMenuItem key={item.href}>
            <SidebarMenuButton asChild isActive={pathname === item.href} tooltip={item.label}>
              <Link href={item.href} onClick={navigate} aria-current={pathname === item.href ? 'page' : undefined}><item.icon /><span>{item.label}</span></Link>
            </SidebarMenuButton>
          </SidebarMenuItem>)}</SidebarMenu></SidebarGroupContent>
        </SidebarGroup>)}
      </nav>
    </SidebarContent>
    <SidebarSeparator />
    <SidebarFooter className="min-w-0 overflow-x-hidden">
      <SidebarMenu>
        <SidebarMenuItem><SidebarMenuButton asChild tooltip="Settings" isActive={pathname === '/settings'}><Link href="/settings" onClick={navigate} aria-current={pathname === '/settings' ? 'page' : undefined}><SlidersHorizontal /><span>Settings</span></Link></SidebarMenuButton></SidebarMenuItem>
        <SidebarMenuItem><SidebarMenuButton asChild tooltip="Profile" isActive={pathname === '/profile'}><Link href="/profile" onClick={navigate} aria-current={pathname === '/profile' ? 'page' : undefined}><UserRound /><span className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden"><span>My account</span><span className="truncate text-[10px] text-muted-foreground">{userEmail}</span></span></Link></SidebarMenuButton></SidebarMenuItem>
        <SidebarMenuItem><form action="/api/auth/signout" method="POST"><SidebarMenuButton type="submit" tooltip="Sign out"><LogOut /><span>Sign out</span></SidebarMenuButton></form></SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  </Sidebar>
}
