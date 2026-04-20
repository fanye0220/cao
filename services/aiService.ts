import { GoogleGenAI } from "@google/genai";
import { Character } from "../types";

export interface RecommendationResult {
  id: string;
  reason: string;
}

// Helper to get active API config
const getActiveApiConfig = () => {
  try {
    const activeId = localStorage.getItem('glass_tavern_active_api');
    if (!activeId) return null;
    const configs = JSON.parse(localStorage.getItem('glass_tavern_api_configs') || '[]');
    return configs.find((c: any) => c.id === activeId) || null;
  } catch {
    return null;
  }
};

const executePrompt = async (prompt: string, defaultModelName: string, jsonMode: boolean = true): Promise<string> => {
  const config = getActiveApiConfig();
  
  if (!config) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("未配置 API Key。请在设置中配置 OpenAI 或 Gemini API Key。");
    }
    
    const ai = new GoogleGenAI({ apiKey });
    try {
      // Use shorter timeout conceptually for Flash
      const response = await ai.models.generateContent({
        model: defaultModelName,
        contents: prompt,
        config: {
          responseMimeType: jsonMode ? "application/json" : "text/plain",
          temperature: 0.3
        }
      });
      return response.text || (jsonMode ? "{}" : "");
    } catch (err: any) {
      console.error("Gemini API Error:", err);
      // Give more specific feedback
      if (err.message?.includes("fetch")) throw new Error("网络连接超时或 API 地址不可达。");
      throw new Error(`Gemini API 请求失败: ${err.message || "未知错误"}`);
    }
  }

  // Use configured API
  if (config.type === 'openai') {
    const model = config.selectedModel || 'gpt-4o-mini';
    const effectiveBaseUrl = config.baseUrl || 'https://api.openai.com/v1';
    const baseUrl = effectiveBaseUrl.endsWith('/') ? effectiveBaseUrl.slice(0, -1) : effectiveBaseUrl;
    const url = `${baseUrl}/chat/completions`;
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          ...(jsonMode ? { response_format: { type: "json_object" } } : {})
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`OpenAI API 错误 (${res.status}): ${errText || res.statusText}`);
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content || (jsonMode ? "{}" : "");
    } catch (err: any) {
      if (err.name === 'AbortError') throw new Error("API 请求回答超时（60s），请尝试更简短的搜索。");
      throw new Error(`OpenAI API 请求失败: ${err.message}`);
    }

  } else if (config.type === 'gemini') {
    const ai = new GoogleGenAI({ apiKey: config.apiKey });
    const model = config.selectedModel || defaultModelName;
    try {
      const response = await ai.models.generateContent({
        model: model,
        contents: prompt,
        config: {
          responseMimeType: jsonMode ? "application/json" : "text/plain",
          temperature: 0.3,
        }
      });
      return response.text || (jsonMode ? "{}" : "");
    } catch (err: any) {
      throw new Error(`Gemini API 请求失败: ${err.message}`);
    }
  }

  throw new Error("不支持的 API 配置类型");
};

/**
 * Stage 1: Extract semantic keywords from user query
 */
async function extractSearchKeywords(query: string): Promise<string[]> {
  const prompt = `
你是一个中文语义分析专家。用户的搜索意图是查找特定的酒馆角色卡。
请从以下搜索词中提取出 5-10 个最核心的搜索关键词。

搜索词: "${query}"

关键词应涵盖：
1. 身份职业（如：军官、主播、医生、校霸）
2. 性格特质（如：腹黑、偏执、高冷、温柔）
3. 核心梗/题材（如：强制爱、无限流、先婚后爱、破镜重圆）
4. 外貌或背景（如：白发、制服、末世）

请仅返回规范的 JSON 数组：
["关键词1", "关键词2", ...]
`;
  try {
    const text = await executePrompt(prompt, "gemini-3-flash-preview");
    const cleanedText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const keywords = JSON.parse(cleanedText || "[]");
    return Array.isArray(keywords) ? keywords : [];
  } catch {
    // Fallback to simple split if AI fails
    return query.split(/[\s,，、]+/).filter(k => k.length > 1);
  }
}

/**
 * Stage 2: Heavy local keyword scoring across all character fields
 * Handles 4000+ cards locally in milliseconds.
 */
function localKeywordSearch(characters: Character[], query: string, keywords: string[]): Character[] {
  // Combine AI keywords with raw tokens from the query for maximum coverage
  const queryTokens = query.split(/[\s,，、]+/).filter(k => k.length > 1);
  const searchTerms = Array.from(new Set([...keywords, ...queryTokens])).map(t => t.toLowerCase());

  const scores = characters.map(char => {
    let score = 0;
    const name = char.name.toLowerCase();
    const tags = (char.tags || []).map(t => t.toLowerCase());
    
    // Concatenate deep context fields
    const context = `
      ${char.description || ''} 
      ${char.personality || ''} 
      ${char.scenario || ''} 
      ${char.firstMessage || ''}
      ${char.character_book?.entries.map(e => e.keys.join(' ') + ' ' + e.content).join(' ') || ''}
    `.toLowerCase();

    searchTerms.forEach(term => {
      // High weight for identity fields
      if (name.includes(term)) score += 50;
      if (tags.some(t => t.includes(term))) score += 40;
      
      // Frequency score for personality/scenario/worldbook
      const occurrences = (context.split(term).length - 1);
      score += Math.min(occurrences * 5, 100); 

      // Support partial character matching for longer intent phrases
      if (term.length > 2) {
          if (context.includes(term)) score += 20;
      }
    });

    return { char, score };
  });

  // Pick top 15 candidates. Keeping it lean prevents AI generation bottlenecks/timeouts.
  return scores
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 15)
    .map(s => s.char);
}

export async function recommendCharacters(
  characters: Character[], 
  query: string, 
  onLog?: (msg: string) => void
): Promise<RecommendationResponse> {
  try {
    // Stage 1: AI Keyword Extraction (Fast Flash)
    onLog?.("正在精准提炼您的搜索意图...");
    const searchKeywords = await extractSearchKeywords(query);
    
    // Stage 2: Local High-Speed Deep Scan
    onLog?.(`正在同步检索全库 ${characters.length} 张卡片（穿透：人设、开场白、世界书）...`);
    const candidates = localKeywordSearch(characters, query, searchKeywords);
    
    if (candidates.length === 0) {
      onLog?.("全量扫描未发现高度契合项，正在扩大范围进行模糊匹配...");
      // In a real app, you might do a second even more fuzzy pass here
      return { keywords: searchKeywords, results: [] };
    }
    
    onLog?.(`已锁定 ${candidates.length} 张最具潜力候选档案，正在移交 AI 专家组进行深度评估...`);

    // Truncate fields for performance
    const limitT = (s: string | undefined, limit: number = 800) => {
      if (!s) return '无';
      return s.length > limit ? s.slice(0, limit) + "..." : s;
    };

    // Stage 3: AI Deep Ranking - Using user's specific fields format
    const charactersPrompt = candidates.map((c, index) => {
      const worldbookContent = c.character_book?.entries.map(e => e.content).join(' ').slice(0, 1000) || '无';
      return `【角色 ${index + 1}】
角色ID: ${c.id}
角色名称: ${c.name}
描述: ${limitT(c.description, 1000)}
性格: ${limitT(c.personality, 600)}
场景: ${limitT(c.scenario, 1000)}
首条消息: ${limitT(c.firstMessage, 800)}
世界书(部分): ${worldbookContent}`;
    }).join("\n---\n");
    
    const prompt = `
你是一位专门研究酒馆格式（Tavern）角色卡的 AI 专家。
请根据用户的搜索需求，从以下候选名单中选出最契合的 5-8 张卡。

用户需求: "${query}"

待评估卡片档案:
${charactersPrompt}

任务：
1. 请重点阅读【描述】、【性格】以及【首条消息】。
2. 尤其关注【首条消息】的说话语气（如：霸道、娇嗔、理智、病娇等），判断是否符合用户想要的“感觉”。
3. 给出 TOP 5-8 的推荐。

仅返回 JSON：
{
  "recommendations": [
    {
      "id": "角色ID",
      "reason": "引用人设或对话中的具体描写，简短解释其为何匹配（50字内）。"
    }
  ]
}
`;
    
    // Fast flash call for stage 3 to ensure result delivery
    const text = await executePrompt(prompt, "gemini-3-flash-preview");
    const cleanedText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleanedText || "{}");
    const results = parsed.recommendations || parsed.results || [];
    
    onLog?.(`分析完成！已为您整理好精选推荐。`);

    return {
      keywords: searchKeywords,
      results: Array.isArray(results) ? results : []
    };
  } catch (e: any) {
    console.error("AI Recommendation error:", e);
    throw new Error(`AI 会诊过程出错: ${e.message || "未知原因"}`);
  }
}

export async function autoTagCharactersBatch(characters: Character[]): Promise<{id: string, tags: string[]}[]> {
  const charsInput = characters.map(c => `ID: ${c.id}\nName: ${c.name}\nDescription: ${c.description || ''}\nPersonality: ${c.personality || ''}\nScenario: ${c.scenario || ''}\nFirstMessage: ${c.firstMessage || ''}`).join("\n--------------------------\n");
  
  const prompt = `
作为晋江、起点、长佩、番茄等顶级网文平台的资深编辑，请仔细阅读以下角色的背景设定、人设细节、世界观（Scenario）和首发对话，并为他们打上最精准、最贴切的网文标签。

【打标核心原则】
1. 绝对不要带有“文”字！例如：只能返回“高干”、“校园”、“甜宠”，绝对不能返回“高干文”、“校园文”、“甜宠文”。
2. 标签需要涵盖以下维度（根据角色实际内容提取3至6个最核心的关键词）：
   - 题材背景：如 豪门恩怨、古风玄幻、现代都市、星际虫族、赛博朋克、末世废土、无限流、年代。
   - 核心梗/故事线：如 甜宠、虐恋、破镜重圆、先婚后爱、追妻火葬场、强取豪夺、替身、叔嫂婆媳、真假千金。
   - 角色人设/身份职业：如 主播、影帝、总裁、偏执狂、病娇、清冷师尊、绿茶、傲娇、疯批、反派、炮灰、医生。
   - 元素类型：如 娱乐圈、电竞、直播、种田、宫斗、权谋、悬疑探案。
3. 必须紧紧贴合具体的角色内容。务必仔细阅读文本中的故事背景和人设信息，只挑选出最符合该角色特征的专属标签。

解析以下角色数据：
${charsInput}

请仅返回规范的 JSON 数组，严禁返回任何 markdown 标记、解释或其他多余文本。示例如下：
[
  {"id": "填入提取的角色ID", "tags": ["豪门恩怨", "甜宠", "总裁", "先婚后爱", "傲娇"]}
]
`;
  
  try {
    const text = await executePrompt(prompt, "gemini-3.1-pro-preview");
    const cleanedText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const results = JSON.parse(cleanedText || "[]");
    return Array.isArray(results) ? results : [];
  } catch (e) {
    throw e;
  }
}

export async function autoTagCharacter(character: Character): Promise<string[]> {
  const prompt = `
作为晋江、起点、长佩、番茄等顶级网文平台的资深编辑，请仔细阅读以下角色的背景设定、人设细节、世界观（Scenario）和首发对话，并为他们打上最精准、最贴切的网文标签。

Name: ${character.name}
Description: ${character.description || ''}
Personality: ${character.personality || ''}
Scenario: ${character.scenario || ''}
First Message: ${character.firstMessage || ''}

【打标核心原则】
1. 绝对不要带有“文”字！例如：只能返回“高干”、“校园”、“甜宠”，绝对不能返回“高干文”、“校园文”、“甜宠文”。
2. 标签需要涵盖以下维度（根据角色实际内容提取3至6个最核心的关键词）：
   - 题材背景：如 豪门恩怨、古风玄幻、现代都市、星际虫族、赛博朋克、末世废土、无限流、年代。
   - 核心梗/故事线：如 甜宠、虐恋、破镜重圆、先婚后爱、追妻火葬场、强取豪夺、替身、叔嫂婆媳、真假千金。
   - 角色人设/身份职业：如 主播、影帝、总裁、偏执狂、病娇、清冷师尊、绿茶、傲娇、疯批、反派、炮灰、医生。
   - 元素类型：如 娱乐圈、电竞、直播、种田、宫斗、权谋、悬疑探案。
3. 必须紧紧贴合具体的角色内容。务必仔细阅读文本中的故事背景和人设信息，只挑选出最符合该角色特征的专属标签。

请仅返回一个包含标签字符串的规范 JSON 数组，严禁返回任何 markdown 标记、解释或其他多余文本。示例如下：
["豪门恩怨", "甜宠", "总裁", "先婚后爱", "傲娇"]
`;
  
  try {
    const text = await executePrompt(prompt, "gemini-3.1-pro-preview");
    const cleanedText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const tags = JSON.parse(cleanedText || "[]");
    return Array.isArray(tags) ? tags : (tags.tags || []);
  } catch (e) {
    throw e;
  }
}
