import { authClient } from "@/lib/auth";

export type CurrentUser = {
  id: string;
  email?: string;
  name?: string;
};

// Better Auth's React adapter exposes useSession(). The generic createAuthClient
// type doesn't always surface this nicely, so we cast.
type SessionShape = {
  data?: { user?: CurrentUser } | null;
  isPending?: boolean;
};

type WithUseSession = { useSession: () => SessionShape };

export function useUser(): {
  user: CurrentUser | null;
  isPending: boolean;
} {
  const client = authClient as unknown as WithUseSession;
  const session = client.useSession?.();
  return {
    user: session?.data?.user ?? null,
    isPending: session?.isPending ?? false,
  };
}
