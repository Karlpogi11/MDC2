import "express-async-errors";
import express from "express";
import cors from "cors";
import { getDb } from "./db/connection";
import { authRouter } from "./routes/auth";
import { sitesRouter } from "./routes/sites";
import { partsRouter } from "./routes/parts";
import { serialsRouter } from "./routes/serials";
import { transfersRouter } from "./routes/transfers";
import { inventoryRouter } from "./routes/inventory";
import { stockInRouter } from "./routes/stockIn";
import { analyticsRouter } from "./routes/analytics";
import { auditLogsRouter } from "./routes/auditLogs";
import { configRouter } from "./routes/config";
import { usersRouter } from "./routes/users";
import { dashboardRouter } from "./routes/dashboard";
import { reportsRouter } from "./routes/reports";
import { exportsRouter } from "./routes/exports";
import { webhooksRouter } from "./routes/webhooks";
import { reportJobsRouter } from "./routes/reportJobs";
import { transferTemplatesRouter } from "./routes/transferTemplates";
import { physicalCountsRouter } from "./routes/physicalCounts";
import { correctionsRouter } from "./routes/corrections";
import { notificationsRouter } from "./routes/notifications";
import { receiveRouter } from "./routes/receive";

const app = express();
const PORT = parseInt(process.env.PORT ?? "3001", 10);
const allowedOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }

    const explicitOrigin = process.env.CORS_ORIGIN;
    if (explicitOrigin && origin === explicitOrigin) {
      callback(null, true);
      return;
    }

    if (allowedOriginPattern.test(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error("CORS blocked"));
  },
  credentials: true,
}));
app.use(express.json({ limit: "50mb" }));

// Health check
app.get("/api/health", async (_req, res) => {
  try {
    await getDb();
    res.json({ status: "ok" });
  } catch (err) {
    res.status(503).json({ status: "error", message: String(err) });
  }
});

// Routes
app.use("/api/auth", authRouter);
app.use("/api/sites", sitesRouter);
app.use("/api/parts", partsRouter);
app.use("/api/serials", serialsRouter);
app.use("/api/transfers", transfersRouter);
app.use("/api/inventory", inventoryRouter);
app.use("/api/stock-in", stockInRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/audit-logs", auditLogsRouter);
app.use("/api/config", configRouter);
app.use("/api/users", usersRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/exports", exportsRouter);
app.use("/api/webhooks", webhooksRouter);
app.use("/api/report-jobs", reportJobsRouter);
app.use("/api/transfer-templates", transferTemplatesRouter);
app.use("/api/physical-counts", physicalCountsRouter);
app.use("/api/corrections", correctionsRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/receive", receiveRouter);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err?.sql ?? err?.message ?? err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`MDC backend running on http://localhost:${PORT}`);
});
