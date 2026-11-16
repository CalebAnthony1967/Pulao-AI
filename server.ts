import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { createApiRouter } from "./server/apiRouter";

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === "production";

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "25mb" }));

  // Mount shared API router
  app.use("/api", createApiRouter());
  app.use("/", createApiRouter());

  // Frontend Serving (Vite Dev Middleware or Built Static Assets)
  if (!isProd) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        watch: {
          ignored: ["**/vault_sandbox/**", "**/server/data/**", "**/evals/**", "**/mcp-server/**"],
        },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(process.cwd(), "dist");
    app.use(express.static(distDir));
    app.get("/{*path}", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Pulao-AI server listening on http://localhost:${PORT} (mode: ${isProd ? "production" : "development"})`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
