import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { Character, Message } from "../types";

// Helper to check if API key exists
export const hasApiKey = (): boolean => {
  return !!process.env.API_KEY;
};

// Initialize Gemini Client
const getClient = () => {
  if (!process.env.API_KEY) {
    throw new Error("API Key is missing. Please ensure process.env.API_KEY is set.");
  }
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
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

/**
 * Streaming chat with a character.
 */
export const streamChatResponse = async function* (
  character: Character, 
  history: Message[], 
  newMessage: string
) {
  const ai = getClient();

  // Construct system instruction
  const systemInstruction = `
    You are roleplaying as ${character.name}.
    
    Description: ${character.description}
    Personality: ${character.personality}
    Scenario: ${character.scenario || 'A casual encounter.'}
    
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