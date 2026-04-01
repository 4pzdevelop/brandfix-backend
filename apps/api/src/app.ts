import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { aiRouter } from "./routes/ai.routes";
import { authenticate } from "./middleware/authenticate";
import { errorHandler } from "./middleware/error-handler";
import { amcRouter } from "./routes/amcs.routes";
import { auditsRouter } from "./routes/audits.routes";
import { authRouter } from "./routes/auth.routes";
import { boqsRouter } from "./routes/boqs.routes";
import { chatRouter } from "./routes/chat.routes";
import { clientsRouter } from "./routes/clients.routes";
import { approvalsRouter } from "./routes/approvals.routes";
import { companiesRouter } from "./routes/companies.routes";
import { accountingRouter } from "./routes/accounting.routes";
import { reccesRouter } from "./routes/recces.routes";
import { reportsRouter } from "./routes/reports.routes";
import { requestsRouter } from "./routes/requests.routes";
import { storesRouter } from "./routes/stores.routes";
import { teamRouter } from "./routes/team.routes";
import { tasksRouter } from "./routes/tasks.routes";

export const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", service: "brandfix-api" });
});

app.get("/api/v1/health", (_req, res) => {
  res.status(200).json({ status: "ok", service: "brandfix-api" });
});

app.use("/api/v1/auth", authRouter);
app.use("/api/v1", authenticate);

app.use("/api/v1/brandfix/ai", aiRouter);
app.use("/api/v1/requests", requestsRouter);
app.use("/api/v1/clients", clientsRouter);
app.use("/api/v1/companies", companiesRouter);
app.use("/api/v1/stores", storesRouter);
app.use("/api/v1/recces", reccesRouter);
app.use("/api/v1/boqs", boqsRouter);
app.use("/api/v1/approvals", approvalsRouter);
app.use("/api/v1/accounting", accountingRouter);
app.use("/api/v1/amcs", amcRouter);
app.use("/api/v1/tasks", tasksRouter);
app.use("/api/v1/audits", auditsRouter);
app.use("/api/v1/reports", reportsRouter);
app.use("/api/v1/team", teamRouter);
app.use("/api/v1/chat", chatRouter);

app.use(errorHandler);
