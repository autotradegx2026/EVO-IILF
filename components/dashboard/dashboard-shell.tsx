'use client'

import { usePathname } from 'next/navigation'
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'
import { TooltipProvider } from '@/components/ui/tooltip'
import { NAV_GROUPS, SidebarNav } from './sidebar-nav'

export function DashboardShell({ children, userEmail, defaultOpen }: { children: React.ReactNode; userEmail: string; defaultOpen: boolean }) {
  const pathname = usePathname()
  const title = NAV_GROUPS.flatMap(group => group.items).find(item => item.href === pathname)?.label ?? (pathname === '/profile' ? 'My account' : 'Settings')
  return <TooltipProvider delayDuration={150}>
    <SidebarProvider defaultOpen={defaultOpen} className="bg-muted/40">
      <a href="#workspace-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-background focus:p-3">Skip to content</a>
      <SidebarNav userEmail={userEmail} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-border/60 bg-background/95 px-4 backdrop-blur-sm sm:px-6">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-5" />
          <span className="truncate text-sm font-medium">{title}</span>
          <span className="ml-auto hidden text-xs text-muted-foreground sm:block">Trading workspace</span>
        </header>
        <main id="workspace-content" tabIndex={-1} className="dashboard-content flex-1 p-4 outline-none sm:p-6 xl:p-8">{children}</main>
      </div>
    </SidebarProvider>
  </TooltipProvider>
}
