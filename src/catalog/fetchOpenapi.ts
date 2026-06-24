import { AppConfig } from "../config.js";

export type OpenApiFetchResult = {
  openapiText: string;
  openapiZhText?: string;
  warning?: string;
};

export async function fetchOpenApiDocuments(config: AppConfig): Promise<OpenApiFetchResult> {
  const [english, chinese] = await Promise.allSettled([
    fetchText(config.openapiUrl, config.timeoutMs),
    fetchText(config.openapiZhUrl, config.timeoutMs),
  ]);

  if (english.status === "rejected") {
    throw new Error(`Failed to fetch English OpenAPI: ${english.reason}`);
  }

  if (chinese.status === "rejected") {
    return {
      openapiText: english.value,
      warning: `Failed to fetch Chinese OpenAPI: ${chinese.reason}`,
    };
  }

  return {
    openapiText: english.value,
    openapiZhText: chinese.value,
  };
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "justoneapi-mcp/2.0",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}
