import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import { config } from "./config";
import { errorHandler } from "./middleware/errorHandler";
import authRoutes from "./routes/auth";
import onboardingRoutes from "./routes/onboarding";
import swaggerSpec from "./swagger";

const app = express();

app.use(cors());
app.use(express.json());
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

/**
 * @openapi
 * /:
 *   get:
 *     tags:
 *       - System
 *     summary: Root API status
 *     responses:
 *       200:
 *         description: API is running
 */
app.get("/", (_req, res) => {
  res.status(200).json({
    status: true,
    message: "Daber Backend API is running"
  });
});

/**
 * @openapi
 * /health:
 *   get:
 *     tags:
 *       - System
 *     summary: Health check
 *     responses:
 *       200:
 *         description: Backend is running
 */
app.get("/health", (_req, res) => {
  res.status(200).json({
    status: true,
    message: "Daber Backend API is healthy",
    details: {
      service: "daber-backend"
    }
  });
});

app.use("/auth", authRoutes);
app.use("/onboarding", onboardingRoutes);
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`Daber backend listening on port ${config.port}`);
});
