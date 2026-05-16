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

    const { filePath, fileName } = await req.json() as { filePath: string; fileName: string };
    if (!filePath || !fileName) return new Response("Missing filePath or fileName", { status: 400 });

    // Download file from storage
    const { data: fileData, error: dlErr } = await client.storage
      .from("imports-stockin")
      .download(filePath);
    if (dlErr || !fileData) throw new Error(`Storage download failed: ${dlErr?.message}`);

    const ext = fileName.split(".").pop()?.toLowerCase();
    const text = await fileData.text();

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
        imported_by: user.id,
        total_rows: rows.length,
        success_rows: 0,
        failed_rows: 0,
      })
      .select("id").single();
    if (batchErr || !batch) throw new Error(`Batch create failed: ${batchErr?.message}`);

    const failedRows: { row: number; serial: string; reason: string }[] = [];
    let successCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const { serial, part_number, part_name } = rows[i];
      try {
        // Upsert part
        const { data: part, error: partErr } = await client
          .from("parts")
          .upsert({ part_number, part_name: part_name ?? part_number }, { onConflict: "part_number" })
          .select("id").single();
        if (partErr || !part) throw new Error(partErr?.message ?? "Part upsert failed");

        // Insert serial
        const { data: newSerial, error: serialErr } = await client
          .from("serial_numbers")
          .insert({
            serial_number: serial,
            part_id: part.id,
            current_site_id: dcSite.id,
            status: "in_stock",
            stock_in_batch_id: batch.id,
          })
          .select("id").single();
        if (serialErr || !newSerial) throw new Error(serialErr?.message ?? "Serial insert failed");

        // Insert stock_in_item
        await client.from("stock_in_items").insert({
          batch_id: batch.id,
          part_id: part.id,
          serial_id: newSerial.id,
          quantity: 1,
        });

        successCount++;
      } catch (err) {
        failedRows.push({ row: i + 2, serial, reason: err instanceof Error ? err.message : "Unknown error" });
      }
    }

    // Update batch counts
    await client.from("stock_in_batches").update({
      success_rows: successCount,
      failed_rows: failedRows.length,
    }).eq("id", batch.id);

    return new Response(
      JSON.stringify({
        batchId: batch.id,
        totalRows: rows.length,
        successRows: successCount,
        failedRows,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unexpected error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
