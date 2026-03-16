import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { Character, Message } from "../types";

const API_KEY_STORAGE_KEY = 'glass_tavern_gemini_api_key';

// Get API key: localStorage first, then env fallback
const getApiKey = (): string | null => {
  return localStorage.getItem(API_KEY_STORAGE_KEY) || process.env.API_KEY || null;
};

// Save user-provided API key to localStorage
export const saveApiKey = (key: string): void => {
  localStorage.setItem(API_KEY_STORAGE_KEY, key.trim());
};

// Remove API key
export const clearApiKey = (): void => {
  localStorage.removeItem(API_KEY_STORAGE_KEY);
};

// Helper to check if API key exists
export const hasApiKey = (): boolean => {
  return !!getApiKey();
};

// Initialize Gemini Client
const getClient = () => {
  const key = getApiKey();
  if (!key) {
    throw new Error("API Key is missing. Please set your Gemini API key in the settings.");
  }
  return new GoogleGenAI({ apiKey: key });
};

/**
 * Generates a full character profile based on a simple prompt/theme.
 */
export const generateCharacterProfile = async (prompt: string): Promise<Partial<Character>> => {
  const ai = getClient();
  
  const systemPrompt = `
    You are a creative writing assistant specialized in creating roleplay characters.
    Based on the user's prompt, generate a JSON object representing a character.
    The JSON must match this structure:
    {
      "name": "Character Name",
      "description": "Short bio (under 50 words)",
      "personality": "Detailed personality traits and quirks",
      "firstMessage": "An engaging opening line for a chat",
      "scenario": "The setting where the character is found"
    }
    Return ONLY valid JSON.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: "application/json"
    }
  });

  const text = response.text;
  if (!text) throw new Error("No response from Gemini");

  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("Failed to parse JSON", e);
    throw new Error("Failed to generate valid character JSON");
  }
};

// Helper to extract active World Info entries
const getActiveWorldInfo = (character: Character, history: Message[], newMessage: string): string => {
  if (!character.character_book || !character.character_book.entries || character.character_book.entries.length === 0) {
    return '';
  }

  // Combine recent history (last 5 messages) and new message to search for keywords
  const recentHistory = history.slice(-5).map(m => m.content).join('\n');
  const searchContext = `${recentHistory}\n${newMessage}`;

  const activeEntries: string[] = [];

  // Sort entries by insertion_order (or priority)
  const sortedEntries = [...character.character_book.entries].sort((a, b) => {
    const orderA = a.insertion_order ?? 50;
    const orderB = b.insertion_order ?? 50;
    return orderA - orderB;
  });

  for (const entry of sortedEntries) {
    if (entry.enabled === false) continue;
    
    // Check if any key is in the search context
    let isMatch = false;
    for (const key of entry.keys) {
      if (!key) continue;
      
      let searchKey = key;
      let context = searchContext;
      
      if (!entry.case_sensitive) {
        searchKey = searchKey.toLowerCase();
        context = context.toLowerCase();
      }
      
      if (context.includes(searchKey)) {
        isMatch = true;
        break;
      }
    }
    
    if (isMatch && entry.content) {
      activeEntries.push(`${entry.name ? `[${entry.name}]: ` : ''}${entry.content}`);
    }
  }

  if (activeEntries.length > 0) {
    return `\n\nWorld Info (Lorebook):\n${activeEntries.join('\n\n')}`;
  }
  
  return '';
};

/**
 * Streaming chat with a character.
 */
export const streamChatResponse = async function* (
  character: Character, 
  history: Message[], 
  newMessage: string
) {
  const ai = getClient();

  const activeWorldInfo = getActiveWorldInfo(character, history, newMessage);

  // Construct system instruction
  const systemInstruction = `
    You are roleplaying as ${character.name}.
    
    Description: ${character.description}
    Personality: ${character.personality}
    Scenario: ${character.scenario || 'A casual encounter.'}${activeWorldInfo}
    
    Instructions:
    - Stay in character at all times.
    - Do not break the fourth wall or mention you are an AI.
    - Write specifically, vividly, and emotionally.
    - Keep responses concise (under 2 paragraphs) unless the user asks for more.
    - React to the user's input based on your personality.
  `;

  // Convert app history to Gemini history format
  // Note: We filter out the very last message (the new one) if it was optimistically added, 
  // but typically 'history' here implies *past* messages.
  // We need to map 'user' -> 'user' and 'model' -> 'model' roles.
  
  // Create a chat session
  const chat = ai.chats.create({
    model: 'gemini-3-flash-preview',
    config: {
      systemInstruction: systemInstruction,
      temperature: 0.8, // Slightly creative
      topK: 40,
    },
    history: history.map(m => ({
      role: m.role,
      parts: [{ text: m.content || '' }]
    }))
  });

  const resultStream = await chat.sendMessageStream({
    message: newMessage
  });

  for await (const chunk of resultStream) {
    const responseChunk = chunk as GenerateContentResponse;
    if (responseChunk.text) {
      yield responseChunk.text;
    }
  }
};