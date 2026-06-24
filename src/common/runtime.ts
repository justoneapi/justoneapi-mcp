import { AppConfig } from "../config.js";
import { CatalogManager } from "../catalog/manager.js";
import { Logger } from "./logger.js";

export type RuntimeContext = {
  transport: "stdio" | "worker";
  config: AppConfig;
  catalogManager: CatalogManager;
  logger: Logger;
  getToken(): string | null;
  isAdmin(): Promise<boolean> | boolean;
};
