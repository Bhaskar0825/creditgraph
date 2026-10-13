// Layout adapted from shadcn/ui dashboard-01. See THIRD_PARTY_NOTICES.md.
import { Network, LockKeyhole, Link2, LoaderCircle, History, ChevronRight, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Sidebar, SidebarProvider, SidebarInset, SidebarTrigger, SidebarHeader, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarMenuBadge, useSidebar } from '@/components/ui/sidebar';

function AppSidebar({ navigation, page, onPage, pending, mode }) {
  const { setOpenMobile } = useSidebar();
  const navigate = (id) => { onPage(id); setOpenMobile(false); };
  return <Sidebar collapsible="icon" variant="inset">
    <SidebarHeader><SidebarMenu><SidebarMenuItem>
      <SidebarMenuButton size="lg" onClick={() => navigate('overview')} tooltip="CreditGraph overview">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Network className="size-4" /></span>
        <span className="grid text-left leading-tight"><span className="font-semibold text-base tracking-tight">CreditGraph</span><span className="text-xs text-muted-foreground">Counterparty intelligence</span></span>
      </SidebarMenuButton>
    </SidebarMenuItem></SidebarMenu></SidebarHeader>
    <SidebarContent><SidebarGroup><SidebarGroupLabel>Workspace</SidebarGroupLabel><SidebarGroupContent>
      <SidebarMenu>{navigation.map(({id,title,icon: Icon}) => <SidebarMenuItem key={id}><SidebarMenuButton className="nav-item" isActive={page === id} aria-current={page === id ? 'page' : undefined} tooltip={title} onClick={() => navigate(id)}><Icon /><span>{title}</span></SidebarMenuButton>{id === 'review' && pending > 0 && <SidebarMenuBadge>{pending}</SidebarMenuBadge>}</SidebarMenuItem>)}</SidebarMenu>
    </SidebarGroupContent></SidebarGroup>
    <SidebarGroup className="mt-auto group-data-[collapsible=icon]:hidden"><div className="rounded-lg border p-3 text-xs leading-relaxed text-muted-foreground"><div className="mb-1 flex items-center gap-2 font-medium text-foreground"><History className="size-3.5" />{mode === 'demo' ? 'Historical replay' : 'Private session'}</div>{mode === 'demo' ? 'Real public evidence. Synthetic exposure amounts. Not a live feed.' : 'Private review decisions. Exposure amounts stay in this tab.'}</div></SidebarGroup></SidebarContent>
    <SidebarFooter><SidebarMenu><SidebarMenuItem><SidebarMenuButton tooltip="Exposure stays in this browser" onClick={() => navigate('exposure')}><LockKeyhole /><span>Browser-local exposure</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarFooter>
  </Sidebar>;
}

export function DashboardLayout({children, navigation, page, onPage, pending, mode, busy, connect, backToDemo}) {
  return <SidebarProvider style={{'--sidebar-width':'15rem','--header-height':'3.5rem'}}>
    <a href="#main-content" className="skip-link">Skip to workspace</a>
    <AppSidebar {...{navigation,page,onPage,pending,mode}} />
    <SidebarInset className="min-w-0">
      <header className="site-header flex h-(--header-height) shrink-0 items-center gap-2 border-b">
        <div className="flex w-full min-w-0 items-center gap-2 px-4 lg:px-6"><SidebarTrigger aria-label="Toggle navigation" /><Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
          <span className="hidden text-sm text-muted-foreground sm:block">Workspace</span><ChevronRight className="hidden size-3 text-muted-foreground sm:block" />
          <h1 className="min-w-0 truncate text-sm font-medium">{navigation.find(item => item.id === page).title}</h1>
          <div className="ml-auto flex shrink-0 items-center gap-2"><Badge variant="outline" className="hidden sm:inline-flex">{mode === 'demo' ? 'Historical demo' : 'Connected'}</Badge>
            {mode === 'demo' ? <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={connect}>{busy === 'connect' ? <LoaderCircle className="spin" /> : <Link2 />}<span className="hidden md:inline">Connect workspace</span><span className="md:hidden">Connect</span></Button> : <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={backToDemo}>Back to demo</Button>}
          </div>
        </div>
      </header>
      <div key={page} id="main-content" className="@container/main flex flex-1 flex-col gap-4 p-4 lg:p-6">{children}</div>
    </SidebarInset>
  </SidebarProvider>;
}
