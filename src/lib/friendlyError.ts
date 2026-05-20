/**
 * Translates raw Supabase/network error messages into user-friendly strings.
 */
export function friendlyError(raw: unknown, fallback = "Something went wrong. Please try again."): string {
  const msg = raw instanceof Error ? raw.message : typeof raw === "string" ? raw : fallback;
  const m = msg.toLowerCase();

  // Network / connectivity
  if (m.includes("fetch") || m.includes("network") || m.includes("failed to fetch"))
    return "Connection error. Check your internet and try again.";

  // Auth
  if (m.includes("invalid login") || m.includes("invalid credentials") || m.includes("email not confirmed"))
    return "Incorrect email or password.";
  if (m.includes("jwt") || m.includes("not authenticated") || m.includes("unauthorized"))
    return "Your session has expired. Please sign in again.";

  // Unique constraint
  if (m.includes("unique") || m.includes("duplicate key") || m.includes("already exists")) {
    if (m.includes("serial")) return "This serial number already exists in the system.";
    if (m.includes("part_number") || m.includes("parts_part_number")) return "This part number already exists.";
    if (m.includes("email")) return "This email is already in use.";
    if (m.includes("username")) return "This username is already taken.";
    if (m.includes("transfer_no")) return "A transfer with this number already exists.";
    return "This record already exists.";
  }

  // Foreign key
  if (m.includes("foreign key") || m.includes("violates foreign key")) {
    if (m.includes("part")) return "Cannot complete — this part is linked to existing serials or transfers.";
    if (m.includes("serial")) return "Cannot complete — this serial is linked to existing records.";
    if (m.includes("site")) return "Cannot complete — this site is linked to existing records.";
    return "Cannot complete — this record is linked to other data.";
  }

  // Not null
  if (m.includes("not-null") || m.includes("null value") || m.includes("violates not-null")) {
    if (m.includes("part_type")) return "Part type is required. Check your CSV has a valid category.";
    if (m.includes("part_name") || m.includes("part_number")) return "Part number and name are required.";
    return "A required field is missing.";
  }

  // RLS / permissions
  if (m.includes("row-level security") || m.includes("permission denied") || m.includes("insufficient privileges"))
    return "You don't have permission to do this.";

  // Not found
  if (m.includes("not found") || m.includes("no rows") || m.includes("0 rows"))
    return "Record not found.";

  // Timeout
  if (m.includes("timeout") || m.includes("statement timeout") || m.includes("canceling statement"))
    return "The request took too long. Try with a smaller file or fewer rows.";

  // Storage
  if (m.includes("storage") || m.includes("bucket") || m.includes("object"))
    return "File upload failed. Check file size and type.";

  // Part not found (custom)
  if (m.includes("not found in parts list"))
    return msg; // already user-friendly

  // RPC application errors — raised via RAISE EXCEPTION in PL/pgSQL.
  // These are intentional, user-facing messages — pass them through as-is.
  // Supabase wraps them as: { message: "...", code: "P0001" }
  if (msg.length > 0 && msg.length < 300 && !m.includes("syntax") && !m.includes("pg_") && !m.includes("internal"))
    return msg;

  return fallback;
}
