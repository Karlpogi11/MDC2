import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/lib/auth";
import { App } from "./App";
import "./styles.css";
import "./theme-enterprise.css";
import { NAVIGATION_CACHE_GC_TIME, NAVIGATION_CACHE_STALE_TIME } from "@/services/navigationCache";

// Remove the flash-prevention style now that real CSS is loaded
document.getElementById("__theme_init")?.remove();

// If we're on the login page, strip dark theme immediately before any paint
if (window.location.pathname === "/login" || window.location.pathname === "/change-password") {
  document.documentElement.classList.remove("dark-theme");
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.background = "#fff";
}

export let pendingPasswordRecovery = false;
export let hadRecoveryHash = window.location.hash.includes("type=recovery") || window.location.hash.includes("type=invite");

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: NAVIGATION_CACHE_STALE_TIME,
      gcTime: NAVIGATION_CACHE_GC_TIME,
      retry: 1,
      refetchOnWindowFocus: false,
    },
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
