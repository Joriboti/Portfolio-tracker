import { AuthView } from "@neondatabase/neon-js/auth/react";
import { useParams } from "react-router-dom";

export function AuthPage() {
  const { pathname } = useParams<{ pathname: string }>();
  // Default to "sign-in" when no sub-path is provided.
  const path = (pathname ?? "sign-in").trim() || "sign-in";

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <div className="card">
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <AuthView path={path as any} />
      </div>
    </div>
  );
}
