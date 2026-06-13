import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
};

export function useNotifications() {
  const queryClient = useQueryClient();
  const query = useQuery<Notification[]>({
    queryKey: ["notifications"],
    queryFn: () => api.get<Notification[]>("/notifications"),
    refetchInterval: 15000,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.put(`/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const allNotifications = query.data ?? [];
  const unread = allNotifications.filter((n) => !n.read_at);

  return {
    ...query,
    notifications: allNotifications,
    unreadCount: unread.length,
    markAllRead: async () => {
      for (const n of unread) {
        await markReadMutation.mutateAsync(n.id);
      }
    },
    markRead: (id: string) => markReadMutation.mutate(id),
  };
}
