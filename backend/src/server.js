import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { spawn } from "child_process";
import { v4 as uuid } from "uuid";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();

app.use(
  cors({
    origin: true,
  })
);

app.use(express.json());


// =====================================================
// PATH CONFIGURATION
// =====================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// backend/src/server.js
//            ↑
//            └── project root = ../../

const projectRoot = path.resolve(
  __dirname,
  "../.."
);

const scraperDirectory = path.join(
  projectRoot,
  "scraper"
);

const pipelinePath = path.join(
  scraperDirectory,
  "pipeline.py"
);


// Windows Python virtual environment
const isWindows = process.platform === "win32";

const pythonExecutable =
  process.env.PYTHON_COMMAND ||
  (
    isWindows
      ? path.join(
          scraperDirectory,
          "venv",
          "Scripts",
          "python.exe"
        )
      : path.join(
          scraperDirectory,
          "venv",
          "bin",
          "python"
        )
  );


// =====================================================
// DATABASE
// =====================================================

const client = new MongoClient(
  process.env.MONGODB_URI
);

await client.connect();

console.log("MongoDB connected");

const db = client.db(
  process.env.MONGODB_DATABASE ||
    "news_pulse"
);

const clusters =
  db.collection("clusters");

const articles =
  db.collection("articles");


// =====================================================
// JOB STORAGE
// =====================================================

const jobs = new Map();


// =====================================================
// HEALTH
// =====================================================

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "news-pulse-api",
  });
});


// =====================================================
// GET CLUSTERS
// =====================================================

app.get("/clusters", async (req, res) => {
  try {
    const data = await clusters
      .find({})
      .sort({
        start_time: -1,
      })
      .toArray();

    res.json(
      data.map((cluster) => ({
        clusterId:
          cluster.cluster_id,

        label:
          cluster.label,

        articleCount:
          cluster.article_count,

        sources:
          cluster.sources || [],

        startTime:
          cluster.start_time,

        endTime:
          cluster.end_time,
      }))
    );

  } catch (error) {

    console.error(
      "GET /clusters error:",
      error
    );

    res.status(500).json({
      error:
        "Failed to load clusters",
    });
  }
});


// =====================================================
// GET SINGLE CLUSTER
// =====================================================

app.get(
  "/clusters/:id",
  async (req, res) => {

    try {

      const cluster =
        await clusters.findOne({
          cluster_id:
            req.params.id,
        });

      if (!cluster) {
        return res.status(404).json({
          error:
            "Cluster not found",
        });
      }

      const clusterArticles =
        await articles
          .find({
            article_id: {
              $in:
                cluster.articles ||
                [],
            },
          })
          .sort({
            published_at: 1,
          })
          .toArray();

      res.json({
        clusterId:
          cluster.cluster_id,

        label:
          cluster.label,

        articleCount:
          cluster.article_count,

        startTime:
          cluster.start_time,

        endTime:
          cluster.end_time,

        articles:
          clusterArticles.map(
            (article) => ({
              articleId:
                article.article_id,

              title:
                article.title,

              summary:
                article.summary,

              source:
                article.source,

              publishedAt:
                article.published_at,

              url:
                article.url,
            })
          ),
      });

    } catch (error) {

      console.error(
        "GET /clusters/:id error:",
        error
      );

      res.status(500).json({
        error:
          "Failed to load cluster",
      });
    }
  }
);


// =====================================================
// TIMELINE
// =====================================================

app.get(
  "/timeline",
  async (req, res) => {

    try {

      const data =
        await clusters
          .find({})
          .sort({
            start_time: 1,
          })
          .toArray();

      res.json(
        data.map((cluster) => ({
          id:
            cluster.cluster_id,

          label:
            cluster.label,

          start:
            cluster.start_time,

          end:
            cluster.end_time,

          articleCount:
            cluster.article_count,

          intensity:
            Math.max(
              1,
              Math.log2(
                (cluster.article_count || 1) +
                  1
              )
            ),

          sources:
            cluster.sources || [],
        }))
      );

    } catch (error) {

      console.error(
        "GET /timeline error:",
        error
      );

      res.status(500).json({
        error:
          "Failed to load timeline",
      });
    }
  }
);


// =====================================================
// TRIGGER PYTHON INGESTION
// =====================================================

app.post(
  "/ingest/trigger",
  (req, res) => {

    const jobId = uuid();

    jobs.set(jobId, {
      status: "running",

      startedAt:
        new Date().toISOString(),

      output: "",
    });


    console.log("");
    console.log(
      "======================================"
    );
    console.log(
      "STARTING NEWS INGESTION"
    );
    console.log(
      "======================================"
    );

    console.log(
      "Project root:",
      projectRoot
    );

    console.log(
      "Python:",
      pythonExecutable
    );

    console.log(
      "Pipeline:",
      pipelinePath
    );


    // -----------------------------------------
    // Verify Python executable
    // -----------------------------------------

    if (!fs.existsSync(pythonExecutable)) {

      const errorMessage =
        `Python executable not found:\n${pythonExecutable}`;

      console.error(
        errorMessage
      );

      jobs.set(jobId, {
        status: "failed",

        startedAt:
          jobs.get(jobId).startedAt,

        finishedAt:
          new Date().toISOString(),

        output:
          errorMessage,
      });

      return res.status(500).json({
        jobId,
        status: "failed",
        error:
          "Python virtual environment was not found.",
      });
    }


    // -----------------------------------------
    // Verify pipeline
    // -----------------------------------------

    if (!fs.existsSync(pipelinePath)) {

      const errorMessage =
        `Pipeline not found:\n${pipelinePath}`;

      console.error(
        errorMessage
      );

      jobs.set(jobId, {
        status: "failed",

        startedAt:
          jobs.get(jobId).startedAt,

        finishedAt:
          new Date().toISOString(),

        output:
          errorMessage,
      });

      return res.status(500).json({
        jobId,
        status: "failed",
        error:
          "Python pipeline was not found.",
      });
    }


    // -----------------------------------------
    // Spawn Python
    // -----------------------------------------

    const pythonProcess =
      spawn(
        pythonExecutable,
        [pipelinePath],
        {
          cwd:
            scraperDirectory,

          windowsHide:
            true,
        }
      );


    let output = "";


    // -----------------------------------------
    // Python STDOUT
    // -----------------------------------------

    pythonProcess.stdout.on(
      "data",
      (data) => {

        const text =
          data.toString();

        output += text;

        console.log(
          `[PYTHON] ${text.trim()}`
        );
      }
    );


    // -----------------------------------------
    // Python STDERR
    // -----------------------------------------

    pythonProcess.stderr.on(
      "data",
      (data) => {

        const text =
          data.toString();

        output += text;

        console.error(
          `[PYTHON ERROR] ${text.trim()}`
        );
      }
    );


    // -----------------------------------------
    // Process failed to start
    // -----------------------------------------

    pythonProcess.on(
      "error",
      (error) => {

        console.error(
          "Python process failed to start:",
          error
        );

        jobs.set(jobId, {
          status: "failed",

          startedAt:
            jobs.get(jobId).startedAt,

          finishedAt:
            new Date().toISOString(),

          output:
            output +
            "\nProcess error: " +
            error.message,
        });
      }
    );


    // -----------------------------------------
    // Process finished
    // -----------------------------------------

    pythonProcess.on(
      "close",
      (code) => {

        console.log(
          `Python process exited with code ${code}`
        );


        const finalStatus =
          code === 0
            ? "completed"
            : "failed";


        jobs.set(jobId, {
          status:
            finalStatus,

          startedAt:
            jobs.get(jobId).startedAt,

          finishedAt:
            new Date().toISOString(),

          output:
            output.slice(-10000),
        });


        console.log(
          `Ingestion job ${jobId}: ${finalStatus}`
        );
      }
    );


    // -----------------------------------------
    // Return job ID immediately
    // -----------------------------------------

    return res.status(202).json({
      jobId,

      status: "running",

      message:
        "News ingestion started.",
    });
  }
);


// =====================================================
// INGESTION STATUS
// =====================================================

app.get(
  "/ingest/status/:jobId",
  (req, res) => {

    const job =
      jobs.get(req.params.jobId);


    if (!job) {

      return res.status(404).json({
        error:
          "Job not found",
      });
    }


    res.json({
      jobId:
        req.params.jobId,

      ...job,
    });
  }
);


// =====================================================
// START SERVER
// =====================================================

const port =
  process.env.PORT || 5000;

app.listen(
  port,
  () => {

    console.log(
      `News Pulse API on ${port}`
    );

    console.log(
      "Python executable:",
      pythonExecutable
    );

    console.log(
      "Pipeline:",
      pipelinePath
    );
  }
);