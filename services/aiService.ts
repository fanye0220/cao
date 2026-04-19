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

const executePrompt = async (prompt: string, defaultModelName: string): Promise<string> => {
  const config = getActiveApiConfig();
  
  if (!config) {
    // Fallback to default Gemini using Env Var if no config is set
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("No API connection configured, and no internal fallback key found.");
    
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: defaultModelName,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.3
      }
    });
    return response.text || "[]";
  }

  // Use configured API
  if (config.type === 'openai') {
    const model = config.selectedModel || 'gpt-3.5-turbo';
    const effectiveBaseUrl = config.baseUrl || 'https://api.openai.com/v1';
    const baseUrl = effectiveBaseUrl.endsWith('/') ? effectiveBaseUrl.slice(0, -1) : effectiveBaseUrl;
    const url = `${baseUrl}/chat/completions`;
    
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
        response_format: { type: "json_object" } // Some standard models require this
      })
    });
    
    if (!res.ok) throw new Error(`OpenAI API Error: ${res.statusText}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "[]";

  } else if (config.type === 'gemini') {
    const ai = new GoogleGenAI({ apiKey: config.apiKey });
    const model = config.selectedModel || defaultModelName;
    const response = await ai.models.generateContent({
      model: model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.3,
        // if baseUrl is set for some reason, genai doesn't natively support proxying easily without custom fetch
      }
    });
    return response.text || "[]";
  }

  throw new Error("Invalid API config type");
};

export interface RecommendationResponse {
  keywords: string[];
  results: RecommendationResult[];
}

export async function recommendCharacters(characters: Character[], query: string): Promise<RecommendationResponse> {
  const charactersPrompt = characters.map(c => 
    `ID: ${c.id}\nName: ${c.name}\nTags: ${(c.tags || []).join(',')}\nDescription: ${c.description || ''}\nPersonality: ${c.personality || ''}\nScenario: ${c.scenario || ''}\n`
  ).join("\n---\n");
  
  // Note: Added explicit JSON structure note for OpenAI compatibility
  const prompt = `
You are a highly strict AI character librarian. I have a list of character cards for a roleplay application. 
Here are the characters:
${charactersPrompt}

A user is searching for character recommendations based on this query: "${query}"

First, extract 3-5 core Chinese keywords from the user's query that describe the desired era, theme, identity, or personality.

CRITICAL INSTRUCTIONS FOR MATCHING:
1. YOU MUST PERFORM STRICT MATCHING based on the literal text or explicit setting of the characters.
2. If the user asks for a specific profession, identity, or trope (e.g., "streamer"/"主播", "vampire", "CEO"), you MUST ONLY return characters where this identity/setting is explicitly written in their Name, Tags, Description, Personality, or Scenario.
3. DO NOT hallucinate or infer roles based on "vibes" or personality. (e.g., Do NOT recommend a character as a "streamer" just because they are "lively, talkative, and good at chatting". They must actually be a streamer).
4. If there are no characters that strictly match the requested identity or setting, return an empty array for recommendations. It is better to return nothing than to return a mismatched character.

Return ONLY a valid JSON object matching this structure:
{
  "keywords": ["keyword1", "keyword2"],
  "recommendations": [
    {
      "id": "character_id",
      "reason": "a short explanation in Chinese of why this character fits the query. Quote the specific part of their setting that proves the match."
    }
  ]
}
Return nothing else. Limit to at most 10 recommendations.
`;
  
  try {
    const text = await executePrompt(prompt, "gemini-3.1-pro-preview");
    // Handle markdown json blocks returned by some models
    const cleanedText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleanedText || "{}");
    
    // Support backward compatibility if the model returns array directly
    if (Array.isArray(parsed)) {
      return { keywords: [], results: parsed };
    }
    
    return {
      keywords: parsed.keywords || [],
      results: parsed.recommendations || []
    };
  } catch (e) {
    console.error("AI Recommendation failed:", e);
    return { keywords: [], results: [] };
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
    console.error("AI Batch Auto Tag failed:", e);
    return [];
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
    console.error("AI Auto Tag failed:", e);
    return [];
  }
}
