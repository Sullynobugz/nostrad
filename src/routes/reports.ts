import { Router } from "express";
import { supabase } from "../services/supabase";
import { generateDailyReport, generateMarkdownReport } from "../reports/dailyReport";
import fs from "fs/promises";
import path from "path";

export const reportsRouter = Router();

// GET /api/reports/daily — Daily Report als JSON
reportsRouter.get("/daily", async (req, res) => {
  try {
    const data = await generateDailyReport();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/reports/daily/markdown — Daily Report als Markdown
reportsRouter.get("/daily/markdown", async (req, res) => {
  try {
    const data = await generateDailyReport();
    const markdown = await generateMarkdownReport(data);

    const reportsDir = path.join(process.cwd(), "reports");
    await fs.mkdir(reportsDir, { recursive: true });
    const filename = path.join(reportsDir, `report-${data.date}.md`);
    await fs.writeFile(filename, markdown, "utf-8");

    res.type("text/markdown").send(markdown);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/reports/performance — Engine Performance Übersicht
reportsRouter.get("/performance", async (req, res) => {
  const { data, error } = await supabase
    .from("engine_performance")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/reports/snapshots — Portfolio Snapshots (für Chart)
reportsRouter.get("/snapshots", async (req, res) => {
  const limit = parseInt(req.query.limit as string || "30");
  const { data, error } = await supabase
    .from("portfolio_snapshots")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });
  res.json((data || []).reverse());
});
