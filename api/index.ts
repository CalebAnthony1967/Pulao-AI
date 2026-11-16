import express from "express";
import { createApiRouter } from "../server/apiRouter";

const app = express();
app.use(express.json({ limit: "25mb" }));

// Mount all API routes under /api (or root if vercel strips prefix)
app.use("/", createApiRouter());
app.use("/api", createApiRouter());

export default app;
