import express from "express";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

import { ingestRouter } from "./routes/ingest";
import { signalsRouter } from "./routes/signals";
import { tradesRouter } from "./routes/trades";
import { reportsRouter } from "./routes/reports";

const app = express();
const PORT = parseInt(process.env.PORT || "3000");

app.use(express.json({ limit: "10mb" }));

// CORS für Dashboard
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Routes
app.use("/api/ingest", ingestRouter);
app.use("/api/signals", signalsRouter);
app.use("/api/trades", tradesRouter);
app.use("/api/reports", reportsRouter);

// Dashboard Static Files
app.use(express.static(path.join(__dirname, "../apps/dashboard/dist")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../apps/dashboard/dist/index.html"));
});
app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "../apps/dashboard/dist/index.html"));
});

// Health Check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    version: "0.1.0",
    timestamp: new Date().toISOString(),
    kronos_mode: process.env.KRONOS_MODE || "native",
    env: process.env.NODE_ENV || "development",
  });
});

// Unbekannte Routes
app.use((req, res) => {
  res.status(404).json({ error: `Route nicht gefunden: ${req.method} ${req.path}` });
});

// Error Handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("[Error]", err.message);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`🔭 Nostrad API läuft auf http://localhost:${PORT}`);
  console.log(`   Kronos Mode: ${process.env.KRONOS_MODE || "native"}`);
  console.log(`   Dashboard: http://localhost:${PORT}/dashboard`);
});

export default app;
