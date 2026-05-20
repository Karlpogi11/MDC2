import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response("Unauthorized", { status: 401 });

    const client = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve caller profile
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return new Response("Unauthorized", { status: 401 });

    const { filePath, fileName, idempotencyKey } = await req.json() as { filePath: string; fileName: string; idempotencyKey?: string };
    if (!filePath || !fileName) return new Response("Missing filePath or fileName", { status: 400 });

    // Rate limiting: 10 imports per 60s per user
    const { data: allowed } = await client.rpc("check_rate_limit", {
      p_user_id: user.id, p_endpoint: "import-stockin", p_limit: 10, p_window_s: 60,
    });
    if (!allowed) return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again in a minute." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Idempotency: return cached response if key already processed
    if (idempotencyKey) {
      const { data: existing } = await client.from("idempotency_keys").select("response").eq("key", idempotencyKey).maybeSingle();
      if (existing?.response) return new Response(JSON.stringify(existing.response), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Download file from storage
    const { data: fileData, error: dlErr } = await client.storage
      .from("imports-stockin")
      .download(filePath);
    if (dlErr || !fileData) throw new Error(`Storage download failed: ${dlErr?.message}`);

    // Compute SHA-256 for duplicate detection
    const fileBytes = await fileData.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", fileBytes);
    const fileHash = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");

    const ext = fileName.split(".").pop()?.toLowerCase();
    const text = new TextDecoder().decode(fileBytes);

    // Parse rows — CSV only for now; xlsx support requires a separate parser
    let rows: { serial: string; part_number: string; part_name?: string }[] = [];

    if (ext === "csv") {
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      const header = lines[0].toLowerCase().split(",").map((h) => h.trim().replace(/"/g, ""));
      const siCol = header.indexOf("serial_number");
      const pnCol = header.indexOf("part_number");
      const nameCol = header.indexOf("part_name");
      if (siCol === -1 || pnCol === -1) throw new Error("CSV must have serial_number and part_number columns.");
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map((c) => c.trim().replace(/"/g, ""));
        const serial = cols[siCol];
        const part_number = cols[pnCol];
        if (serial && part_number) rows.push({ serial, part_number, part_name: nameCol >= 0 ? cols[nameCol] : undefined });
      }
    } else {
      throw new Error("XLSX parsing not yet supported server-side. Please use CSV.");
    }

    if (rows.length === 0) throw new Error("No valid rows found in file.");
    if (rows.length > 1000) throw new Error("Import limit is 1000 rows per batch.");

    // Sanitize field lengths
    rows = rows.map((r) => ({
      serial: r.serial.slice(0, 100),
      part_number: r.part_number.slice(0, 100),
      part_name: r.part_name?.slice(0, 200),
    }));

    // Resolve DC site
    const { data: dcSite } = await client.from("sites").select("id").eq("is_dc", true).single();
    if (!dcSite) throw new Error("DC site not found.");

    // Create batch record
    const { data: batch, error: batchErr } = await client
      .from("stock_in_batches")
      .insert({
        source_type: ext === "csv" ? "csv" : "xlsx",
        source_file_name: fileName,
        file_hash: fileHash,
        imported_by: user.id,
        total_rows: rows.length,
        success_rows: 0,
        failed_rows: 0,
      })
      .select("id").single();
    if (batchErr || !batch) throw new Error(`Batch create failed: ${batchErr?.message}`);

    const failedRows: { row: number; serial: string; reason: string }[] = [];
    let successCount = 0;

    // Batch-fetch all referenced part numbers in one query
    const uniquePartNumbers = [...new Set(rows.map((r) => r.part_number))];
    const { data: partsData } = await client
      .from("parts")
      .select("id, part_number")
      .in("part_number", uniquePartNumbers)
      .eq("is_active", true);
    const partMap = new Map((partsData ?? []).map((p: any) => [p.part_number, p.id]));

    // Validate all rows upfront, split into valid/failed
    const validRows: { serial: string; part_number: string; rowNum: number }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const { serial, part_number } = rows[i];
      const partId = partMap.get(part_number);
      if (!partId) {
        failedRows.push({ row: i + 2, serial, reason: `Part number "${part_number}" not found. Add it in Config → Parts first.` });
      } else {
        validRows.push({ serial, part_number, rowNum: i + 2 });
      }
    }

    // Bulk insert serials inside a transaction via RPC
    // If any insert fails, the entire batch rolls back — no partial commits
    if (validRows.length > 0) {
      const serialInserts = validRows.map((r) => ({
        serial_number: r.serial,
        part_id: partMap.get(r.part_number),
        current_site_id: dcSite.id,
        status: "in_stock",
        stock_in_batch_id: batch.id,
      }));

      const { data: inserted, error: insertErr } = await client.rpc("bulk_insert_serials", {
        p_batch_id: batch.id,
        p_serials: serialInserts,
      });

      if (insertErr) {
        // Entire batch failed — mark all valid rows as failed
        for (const r of validRows) failedRows.push({ row: r.rowNum, serial: r.serial, reason: insertErr.message });
      } else {
        const insertedMap = new Map((inserted ?? []).map((r: any) => [r.serial_number, r.id]));
        // Bulk insert stock_in_items for successfully inserted serials
        const items = validRows
          .filter((r) => insertedMap.has(r.serial))
          .map((r) => ({ batch_id: batch.id, part_id: partMap.get(r.part_number), serial_id: insertedMap.get(r.serial), quantity: 1 }));
        if (items.length > 0) await client.from("stock_in_items").insert(items);
        successCount = items.length;
        for (const r of validRows) {
          if (!insertedMap.has(r.serial)) failedRows.push({ row: r.rowNum, serial: r.serial, reason: "Duplicate serial or constraint violation" });
        }
      }
    }

    // Update batch counts
    await client.from("stock_in_batches").update({
      success_rows: successCount,
      failed_rows: failedRows.length,
    }).eq("id", batch.id);

    const responseBody = {
      batchId: batch.id,
      totalRows: rows.length,
      successRows: successCount,
      failedRows,
    };

    // Cache response for idempotency replay
    if (idempotencyKey) {
      await client.from("idempotency_keys").upsert({ key: idempotencyKey, user_id: user.id, response: responseBody });
    }

    return new Response(
      JSON.stringify(responseBody),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unexpected error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
