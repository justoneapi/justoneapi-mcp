import { z } from "zod";
import { requireToken } from "../../common/config.js";
import { getJson } from "../../common/http.js";

export const KuaishouSearchVideoV2Input = z.object({
  keyword: z.string().min(1).describe("Search keyword, e.g. 'dance'"),
  page: z.number().int().min(1).default(1).describe("Page number, default 1"),
});

export async function kuaishouSearchVideoV2(input: z.infer<typeof KuaishouSearchVideoV2Input>) {
  const token = encodeURIComponent(requireToken());
  const keyword = encodeURIComponent(input.keyword);
  const page = input.page; // zod default ensures it's a number

  return await getJson(
    `/api/kuaishou/search-video/v2?token=${token}&keyword=${keyword}&page=${page}`
  );
}
