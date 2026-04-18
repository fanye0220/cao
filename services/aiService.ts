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
    const baseUrl = config.baseUrl.endsWith('/') ? config.baseUrl.slice(0, -1) : config.baseUrl;
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

export async function recommendCharacters(characters: Character[], query: string): Promise<RecommendationResult[]> {
  const charactersPrompt = characters.map(c => `ID: ${c.id}\nName: ${c.name}\nDescription: ${c.description || ''}\nPersonality: ${c.personality || ''}\n`).join("\n---\n");
  
  // Note: Added explicit JSON structure note for OpenAI compatibility
  const prompt = `
I have a list of character cards for a roleplay application. 
Here are the characters:
${charactersPrompt}

A user is searching for character recommendations based on this query: "${query}"

Find the best matching characters.
Return ONLY a valid JSON array of objects, where each object has:
- "id": the character ID (string)
- "reason": a short explanation in Chinese of why this character fits the query (string)
Return nothing else. Example: [{"id": "1", "reason": "test"}] Limit to at most 5 recommendations.
`;
  
  try {
    const text = await executePrompt(prompt, "gemini-3.1-pro-preview");
    // Handle markdown json blocks returned by some models
    const cleanedText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const results = JSON.parse(cleanedText || "[]");
    return Array.isArray(results) ? results : (results.recommendations || []);
  } catch (e) {
    console.error("AI Recommendation failed:", e);
    return [];
  }
}

export async function autoTagCharactersBatch(characters: Character[]): Promise<{id: string, tags: string[]}[]> {
  const charsInput = characters.map(c => `ID: ${c.id}\nName: ${c.name}\nDescription: ${c.description || ''}\nPersonality: ${c.personality || ''}\nScenario: ${c.scenario || ''}\nFirstMessage: ${c.firstMessage || ''}`).join("\n--------------------------\n");
  
  const prompt = `
You are an expert editor at a top Chinese web novel platform (like Qidian or Jinjiang). 
Analyze the following roleplay characters and carefully read their descriptions and first messages.

For each character, assign 3 to 6 accurate, descriptive tags. 
The tags MUST include:
1. Era/Background (e.g., 现代都市, 星际, 古风, 赛博朋克, 校园, 废土, 仙侠, 西幻)
2. Content/Theme (e.g., 豪门, 悬疑, 甜宠, 无限流, 快穿, 规则怪谈, 种田)
3. Persona/Archetype (e.g., 病娇, 傲娇, 高冷之花, 疯批, 钓系, 偏执狂, 绿茶)

DO NOT use "xx文" format (like 校园文, 甜宠文). Just use "校园", "甜宠".
Make the tags extremely precise based on the character's exact setting.

Here are the characters:
${charsInput}

Return ONLY a valid JSON array of objects. Return nothing else. Example:
[
  {"id": "character_id_here", "tags": ["古风", "甜宠", "腹黑"]}
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
Analyze the following character for a roleplay novel scenario.
Name: ${character.name}
Description: ${character.description || ''}
Personality: ${character.personality || ''}
Scenario: ${character.scenario || ''}
First Message: ${character.firstMessage || ''}

Assign 2-4 descriptive novel genre/trope tags (like 高干, 甜宠, 虐恋, 病娇, 校园, 悬疑, etc.) that fit this character perfectly.
Return ONLY a valid JSON array of strings (the tags). Return nothing else. Example: ["tag1", "tag2"]
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
