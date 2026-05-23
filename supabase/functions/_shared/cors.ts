const DEFAULT_LOCAL_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

type CorsOptions = {
  methods?: string;
  headers?: string;
  maxAge?: string;
};

function normalizeOrigin(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function configuredOrigins(): string[] {
  const configured = (Deno.env.get("CORS_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map(normalizeOrigin)
    .filter((origin): origin is string => Boolean(origin));

  const appOrigin = normalizeOrigin(Deno.env.get("APP_URL"));
  const origins = [...DEFAULT_LOCAL_ORIGINS, ...configured];
  if (appOrigin) origins.push(appOrigin);

  return Array.from(new Set(origins));
}

function originForRequest(req: Request): string {
  const requestOrigin = normalizeOrigin(req.headers.get("Origin"));
  const allowed = configuredOrigins();

  if (requestOrigin && allowed.includes(requestOrigin)) {
    return requestOrigin;
  }

  return allowed[0] ?? "http://localhost:5173";
}

export function corsHeadersForRequest(req: Request, options: CorsOptions = {}): Record<string, string> {
  const requestedHeaders = req.headers.get("Access-Control-Request-Headers")?.trim();

  return {
    "Access-Control-Allow-Origin": originForRequest(req),
    "Access-Control-Allow-Methods": options.methods ?? "POST, OPTIONS",
    "Access-Control-Allow-Headers": requestedHeaders || options.headers || "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": options.maxAge ?? "86400",
    "Vary": "Origin, Access-Control-Request-Headers",
  };
}
