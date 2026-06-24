export type PlatformDictionaryEntry = {
  name: string;
  aliases: string[];
};

export const PLATFORM_DICTIONARY: Record<string, PlatformDictionaryEntry> = {
  search: {
    name: "跨平台搜索",
    aliases: ["跨平台搜索", "全平台搜索", "社媒搜索", "search"],
  },
  douyin: {
    name: "抖音",
    aliases: ["抖音", "douyin", "tiktok china", "国内版tiktok"],
  },
  douyin_ec: {
    name: "抖音电商",
    aliases: ["抖音电商", "抖音小店", "douyin ec", "douyin ecommerce"],
  },
  douyin_xingtu: {
    name: "抖音星图",
    aliases: ["抖音星图", "巨量星图", "星图", "douyin xingtu", "xingtu"],
  },
  xiaohongshu: {
    name: "小红书",
    aliases: ["小红书", "小红薯", "小红暑", "rednote", "red note", "xhs", "little red book"],
  },
  xiaohongshu_pgy: {
    name: "小红书蒲公英",
    aliases: ["小红书蒲公英", "蒲公英", "pgy", "xiaohongshu pgy"],
  },
  kuaishou: {
    name: "快手",
    aliases: ["快手", "kuaishou", "kwai"],
  },
  weibo: {
    name: "微博",
    aliases: ["微博", "新浪微博", "weibo"],
  },
  weixin: {
    name: "微信",
    aliases: ["微信", "微信公众号", "公众号", "weixin", "wechat"],
  },
  weixin_channels: {
    name: "微信视频号",
    aliases: ["视频号", "微信视频号", "weixin channels", "wechat channels"],
  },
  bilibili: {
    name: "哔哩哔哩",
    aliases: ["哔哩哔哩", "b站", "bilibili", "bili"],
  },
  zhihu: {
    name: "知乎",
    aliases: ["知乎", "zhihu"],
  },
  taobao: {
    name: "淘宝",
    aliases: ["淘宝", "天猫", "taobao", "tmall"],
  },
  jd: {
    name: "京东",
    aliases: ["京东", "jd", "jingdong"],
  },
  field_1688: {
    name: "1688",
    aliases: ["1688", "阿里巴巴批发", "alibaba wholesale"],
  },
  amazon: {
    name: "亚马逊",
    aliases: ["亚马逊", "amazon"],
  },
  tiktok: {
    name: "TikTok",
    aliases: ["tiktok", "海外抖音"],
  },
  tiktok_shop: {
    name: "TikTok Shop",
    aliases: ["tiktok shop", "tiktok商城", "tiktok小店"],
  },
  youtube: {
    name: "YouTube",
    aliases: ["youtube", "油管"],
  },
  instagram: {
    name: "Instagram",
    aliases: ["instagram", "ins"],
  },
  twitter: {
    name: "Twitter/X",
    aliases: ["twitter", "x", "推特"],
  },
  facebook: {
    name: "Facebook",
    aliases: ["facebook", "脸书"],
  },
  reddit: {
    name: "Reddit",
    aliases: ["reddit"],
  },
  imdb: {
    name: "IMDb",
    aliases: ["imdb", "影视"],
  },
  douban: {
    name: "豆瓣",
    aliases: ["豆瓣", "douban"],
  },
  beike: {
    name: "贝壳",
    aliases: ["贝壳", "房产", "二手房", "beike"],
  },
  toutiao: {
    name: "今日头条",
    aliases: ["今日头条", "头条", "toutiao"],
  },
  web: {
    name: "网页",
    aliases: ["网页", "网站", "html", "markdown", "web"],
  },
  llm: {
    name: "大模型",
    aliases: ["大模型", "豆包", "llm"],
  },
};

export function platformDisplayName(platform: string): string {
  return PLATFORM_DICTIONARY[platform]?.name ?? platform;
}

export function platformAliases(platform: string): string[] {
  const entry = PLATFORM_DICTIONARY[platform];
  if (!entry) return [platform];
  return [entry.name, platform, ...entry.aliases];
}
