import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/lib/auth";
import { App } from "./App";
import "./styles.css";
import "./theme-enterprise.css";
import { getSupabaseClient } from "@/lib/supabase";

// Remove the flash-prevention style now that real CSS is loaded
document.getElementById("__theme_init")?.remove();

// If we're on the login page, strip dark theme immediately before any paint
if (window.location.pathname === "/login" || window.location.pathname === "/change-password") {
  document.documentElement.classList.remove("dark-theme");
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.background = "#f5f5f7";
}

// Capture PASSWORD_RECOVERY event before React renders
export let pendingPasswordRecovery = false;
export let hadRecoveryHash = window.location.hash.includes("type=recovery") || window.location.hash.includes("type=invite");
const client = getSupabaseClient();
if (client) {
  client.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") {
      pendingPasswordRecovery = true;
    }
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
