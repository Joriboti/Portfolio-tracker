import { NeonAuthUIProvider } from "@neondatabase/neon-js/auth/react";
import { authClient } from "@/lib/auth";

// The Neon Auth UI provider, mounted only around the views that need it
// (<AuthView> and <AccountView>). Keeping it out of main.tsx keeps the auth UI
// bundle off every public landing page; the settings here must stay identical
// in both places, which is why they live in one component.
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <NeonAuthUIProvider
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      authClient={authClient as any}
      emailOTP
      magicLink
    >
      {children}
    </NeonAuthUIProvider>
  );
}
