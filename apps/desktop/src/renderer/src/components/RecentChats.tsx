import { ArrowRightIcon } from "lucide-react";
import { useApp } from "@/lib/store.ts";
import { recentChats } from "@/lib/recent-chats.ts";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

export function RecentChats() {
  const library = useApp((s) => s.library),
    loaded = useApp((s) => s.libraryLoaded),
    route = useApp((s) => s.route),
    go = useApp((s) => s.go);
  const { isMobile, setOpenMobile } = useSidebar();
  const chats = recentChats(library);
  const activeId = route.name === "series" ? route.id
    : route.name === "episode" ? route.seriesId : undefined;

  return (
    <SidebarGroup className="recent-chats group-data-[collapsible=icon]:hidden" aria-label="Recent chats">
      <SidebarGroupLabel>Recent chats</SidebarGroupLabel>
      <SidebarGroupContent>
        {chats.length > 0 ? (
          <SidebarMenu>
            {chats.map((chat) => {
              const active = activeId === chat.id;
              const status = chat.running ? "Generating"
                : chat.next.kind === "finished" ? "Finished"
                : chat.next.kind === "waiting" && chat.next.status === "awaiting_approval" ? "Ready for review"
                : chat.next.kind === "waiting" && chat.next.status === "failed" ? "Needs attention"
                : "In progress";
              const title = chat.title.trim() || "Untitled chat";
              return (
                <SidebarMenuItem key={chat.id}>
                  <SidebarMenuButton
                    className="recent-chat-row"
                    isActive={active}
                    aria-current={active ? "page" : undefined}
                    title={`${title} · ${status}`}
                    onClick={() => {
                      go({ name: "series", id: chat.id });
                      // Keep the drawer open if an unsaved-work guard held navigation.
                      const next = useApp.getState().route;
                      if (isMobile && next.name === "series" && next.id === chat.id) setOpenMobile(false);
                    }}
                  >
                    <span className="recent-chat-dot" data-active={active} data-running={chat.running} aria-hidden="true" />
                    <span>{title}</span>
                    <span className="sr-only">{status}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
            {library.length > chats.length && (
              <SidebarMenuItem>
                <SidebarMenuButton className="recent-chats-all" onClick={() => {
                  go({ name: "library" });
                  if (isMobile && useApp.getState().route.name === "library") setOpenMobile(false);
                }}>
                  <ArrowRightIcon />
                  <span>View all chats</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        ) : (
          <p className="recent-chats-empty">{loaded ? "Your chats will appear here." : "Loading chats…"}</p>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
