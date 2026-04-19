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
        })
      });
      
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`OpenAI API 错误 (${res.status}): ${errText || res.statusText}`);
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content || (jsonMode ? "{}" : "");
    } catch (err: any) {
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
function localKeywordSearch(characters: Character[], keywords: string[]): Character[] {
  const scores = characters.map(char => {
    let score = 0;
    const content = `
      ${char.name} 
      ${(char.tags || []).join(' ')} 
      ${char.description || ''} 
      ${char.personality || ''} 
      ${char.scenario || ''} 
      ${char.firstMessage || ''}
      ${char.character_book?.entries.map(e => e.keys.join(' ') + ' ' + e.content).join(' ') || ''}
    `.toLowerCase();

    keywords.forEach(kw => {
      const lowerKw = kw.toLowerCase();
      // Weighted match: Name and Tags are highly important
      if (char.name.toLowerCase().includes(lowerKw)) score += 20;
      if ((char.tags || []).some(t => t.toLowerCase().includes(lowerKw))) score += 15;
      
      // Substring frequency match
      const count = (content.split(lowerKw).length - 1);
      score += Math.min(count * 2, 30); // Max 30 points for frequency to prevent spamming
    });

    return { char, score };
  });

  // Sort by score and take top 40 candidates
  return scores
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 40)
    .map(s => s.char);
}

export async function recommendCharacters(
  characters: Character[], 
  query: string, 
  onLog?: (msg: string) => void
): Promise<RecommendationResponse> {
  // Stage 1: AI Keyword Extraction
  onLog?.("正在进行语义分析并提取关键词...");
  const searchKeywords = await extractSearchKeywords(query);
  onLog?.(`提取关键词: [${searchKeywords.join(', ')}]`);

  // Stage 2: Fast Local Scanning
  onLog?.(`正在对库中 ${characters.length} 个角色进行全文本深度扫描（含设定、开场白、世界书）...`);
  const candidates = localKeywordSearch(characters, searchKeywords);
  
  if (candidates.length === 0) {
    onLog?.("本地全量检索未发现匹配项。");
    return { keywords: searchKeywords, results: [] };
  }
  onLog?.(`初步筛选出 ${candidates.length} 张最具潜力角色卡，移交 AI 进行深度评估...`);

  // Stage 3: AI Deep Ranking
  const charactersPrompt = candidates.map(c => 
    `ID: ${c.id}\nName: ${c.name}\nTags: ${(c.tags || []).join(',')}\n人设设定: ${c.description || ''}\n性格: ${c.personality || ''}\n背景/世界书: ${c.scenario || ''}\n开场白: ${c.firstMessage || ''}\n`
  ).join("\n---\n");
  
  const prompt = `
你是一位资深、毒辣的小说/Roleplay卡牌管理员。
我有 4000+ 角色卡，我已经通过关键词初步帮你筛选出了 40 张最接近的用户卡。
请你仔细阅读这些卡片的【人设设置】、【背景世界观】以及【首句对话】，为用户推荐最符合需求的目标。

用户需求: "${query}"
候选关键词: ${searchKeywords.join(', ')}

待评估角色卡列表如下：
${charactersPrompt}

任务：
1. 从 40 个候选人中，选出最契合用户口味的 TOP 5-10。
2. 评价标准：一定要看重性格（腹黑、偏执等）和开场白带来的氛围。
3. 必须解释为什么推荐，引用卡片具体设定的原话。

返回规范 JSON 对象：
{
  "keywords": ${JSON.stringify(searchKeywords)},
  "recommendations": [
    {
      "id": "角色ID",
      "reason": "引用人设、开场白或世界书中的具体描写，说明为什么这个卡很对味。"
    }
  ]
}
不要编造卡片内容。最多 10 个。
`;
  
  try {
    const text = await executePrompt(prompt, "gemini-3.1-pro-preview");
    const cleanedText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleanedText || "{}");
    const results = parsed.recommendations || parsed.results || [];
    
    return {
      keywords: parsed.keywords || searchKeywords,
      results: Array.isArray(results) ? results : []
    };
  } catch (e) {
    throw e;
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
