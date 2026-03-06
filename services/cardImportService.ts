import { Character } from "../types";
import JSZip from "jszip";
import { saveImage } from "./imageService";

/**
 * 将内部 Character 对象还原为标准 ST 角色卡 JSON 格式。
 * 优先使用 _rawCardData 还原原始结构，只覆盖用户编辑过的字段。
 * 这样可以保留 extensions、creator、character_version 等所有原始字段。
 */
const buildJsonExport = (character: Character): any => {
  const raw = character._rawCardData;
  const finalQrList = (character.extra_qr_data?.qrList?.length > 0)
    ? character.extra_qr_data.qrList
    : (character.qrList || []);

  if (raw) {
    const isV2orV3 = raw.spec === 'chara_card_v2' || raw.spec === 'chara_card_v3';
    if (isV2orV3 && raw.data) {
      return {
        ...raw,
        data: {
          ...raw.data,
          name: character.name,
          description: character.description,
          personality: character.personality,
          first_mes: character.firstMessage,
          alternate_greetings: character.alternate_greetings,
          scenario: character.scenario,
          character_book: character.character_book,
          tags: character.tags,
          creator_notes: character.creator_notes ?? raw.data.creator_notes ?? "",
          qrList: finalQrList,
        }
      };
    } else {
      return {
        ...raw,
        name: character.name,
        description: character.description,
        personality: character.personality,
        first_mes: character.firstMessage,
        alternate_greetings: character.alternate_greetings,
        scenario: character.scenario,
        character_book: character.character_book,
        tags: character.tags,
        creator_notes: character.creator_notes ?? raw.creator_notes ?? "",
        qrList: finalQrList,
      };
    }
  }

  // 无原始数据（新建卡）：输出标准 V2
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: character.name,
      description: character.description,
      personality: character.personality,
      first_mes: character.firstMessage,
      alternate_greetings: character.alternate_greetings || [],
      scenario: character.scenario || "",
      character_book: character.character_book,
      tags: character.tags || [],
      mes_example: "",
      creator_notes: character.creator_notes || "",
      system_prompt: "",
      post_history_instructions: "",
      creator: "",
      character_version: "",
      extensions: {},
      qrList: finalQrList,
      sourceUrl: character.sourceUrl || "",
    }
  };
};

// Helper to read text from buffer using TextDecoder for UTF-8 support
const readText = (buffer: Uint8Array, start: number, length: number): string => {
  const slice = buffer.slice(start, start + length);
  return new TextDecoder('utf-8').decode(slice);
};

// Helper to decode Base64 string that might contain UTF-8 characters
const decodeBase64Utf8 = (base64: string): string => {
  // If it's already JSON, just return it
  if (base64.trim().startsWith('{') && base64.trim().endsWith('}')) {
      return base64;
  }
  // Remove any whitespace characters and fix URL-safe base64
  let cleanBase64 = base64.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
  
  // Pad with '=' if necessary
  while (cleanBase64.length % 4) {
      cleanBase64 += '=';
  }

  try {
    const binaryString = atob(cleanBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
  } catch (e) {
    throw e;
  }
};

// Helper for zTXt decompression (using DecompressionStream if available, or simple inflate if we had pako, but we don't)
// Since we don't have pako, we will try to use DecompressionStream which is available in modern browsers.
// Note: zTXt uses zlib format (RFC 1950), which has a 2-byte header and 4-byte checksum wrapping the deflate stream.
// DecompressionStream('deflate') typically expects raw deflate (RFC 1951).
// We might need to strip the header (2 bytes) and checksum (4 bytes) for DecompressionStream.
const decompressZlib = async (data: Uint8Array): Promise<string> => {
  try {
    // 1. Try raw deflate (RFC 1951) - common in some implementations
    try {
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        writer.write(data);
        writer.close();
        const buffer = await new Response(ds.readable).arrayBuffer();
        return new TextDecoder('utf-8').decode(buffer);
    } catch (e) {
        // ignore and try next
    }

    // 2. Try zlib (RFC 1950) - 'deflate' in DecompressionStream usually means zlib format
    try {
        const ds = new DecompressionStream('deflate');
        const writer = ds.writable.getWriter();
        writer.write(data);
        writer.close();
        const buffer = await new Response(ds.readable).arrayBuffer();
        return new TextDecoder('utf-8').decode(buffer);
    } catch (e) {
        // ignore and try next
    }

    // 3. Try stripping zlib header/footer manually (if 'deflate' failed but data has headers)
    if (data.length > 6) {
         const sliced = data.slice(2, data.length - 4);
         const ds = new DecompressionStream('deflate-raw');
         const writer = ds.writable.getWriter();
         writer.write(sliced);
         writer.close();
         const buffer = await new Response(ds.readable).arrayBuffer();
         return new TextDecoder('utf-8').decode(buffer);
    }
    
    return "";
  } catch (e) {
    console.error("Decompression failed", e);
    return "";
  }
};

// Main parsing function
export const parseCharacterCard = async (file: File): Promise<Character> => {
  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  const dataView = new DataView(arrayBuffer);

  // Check PNG Signature
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (uint8Array[i] !== signature[i]) {
      throw new Error("不是有效的 PNG 文件");
    }
  }

  let offset = 8; // Skip header
  let characterData: any = null;
  const potentialJsonChunks: string[] = [];

  while (offset < uint8Array.length) {
    // Read Chunk Length
    if (offset + 4 > uint8Array.length) break;
    const length = dataView.getUint32(offset);
    offset += 4;

    // Read Chunk Type
    if (offset + 4 > uint8Array.length) break;
    const type = readText(uint8Array, offset, 4);
    offset += 4;

    const chunkDataStart = offset;
    const chunkDataEnd = offset + length;
    
    if (offset + length > uint8Array.length) {
        console.warn("Chunk length exceeds file size, truncating.");
        break;
    }

    if (type === 'tEXt') {
      // tEXt format: Keyword + null + Text
      let nullSeparatorIndex = -1;
      for (let i = chunkDataStart; i < chunkDataEnd; i++) {
        if (uint8Array[i] === 0) {
          nullSeparatorIndex = i;
          break;
        }
      }

      if (nullSeparatorIndex !== -1) {
        const keyword = readText(uint8Array, chunkDataStart, nullSeparatorIndex - chunkDataStart);
        const textData = readText(uint8Array, nullSeparatorIndex + 1, chunkDataEnd - (nullSeparatorIndex + 1));
        const lowerKeyword = keyword.toLowerCase();
        
        // Always store for fallback if it looks like data
        if (textData.length > 10) {
            potentialJsonChunks.push(textData);
        }

        if (['chara', 'character', 'ccv3', 'tavern', 'sillytavern'].includes(lowerKeyword)) {
          try {
            const decoded = decodeBase64Utf8(textData);
            characterData = JSON.parse(decoded);
          } catch (e) {
            console.error(`Found '${keyword}' chunk but failed to parse.`, e);
            // Fallback: maybe it's not base64?
            try {
                characterData = JSON.parse(textData);
            } catch (e2) {
                // ignore
            }
          }
        }
      } else {
          // No null separator found. This is strictly invalid tEXt, but some tools might just dump data.
          // Try to read the whole chunk as text.
          const textData = readText(uint8Array, chunkDataStart, chunkDataEnd - chunkDataStart);
          if (textData.length > 10) {
              potentialJsonChunks.push(textData);
          }
      }
    } else if (type === 'zTXt') {
        // zTXt format: Keyword + null + CompressionMethod(0) + CompressedData
        let nullSeparatorIndex = -1;
        for (let i = chunkDataStart; i < chunkDataEnd; i++) {
            if (uint8Array[i] === 0) {
                nullSeparatorIndex = i;
                break;
            }
        }

        if (nullSeparatorIndex !== -1) {
            const keyword = readText(uint8Array, chunkDataStart, nullSeparatorIndex - chunkDataStart);
            const lowerKeyword = keyword.toLowerCase();
            
            // Try to decompress regardless of keyword
            const compressedData = uint8Array.slice(nullSeparatorIndex + 2, chunkDataEnd);
            try {
                const textData = await decompressZlib(compressedData);
                if (textData) {
                    // Store for fallback if it looks like JSON or Base64
                    if (textData.length > 10) {
                        potentialJsonChunks.push(textData);
                    }

                    // If standard keyword, try to parse immediately
                    if (['chara', 'character', 'ccv3', 'tavern', 'sillytavern'].includes(lowerKeyword)) {
                        try {
                            const decoded = decodeBase64Utf8(textData);
                            characterData = JSON.parse(decoded);
                        } catch (e) {
                             // Fallback: maybe it's not base64?
                             try {
                                 characterData = JSON.parse(textData);
                             } catch (e2) {
                                 // ignore
                             }
                        }
                    }
                }
            } catch (e) {
                // console.error(`Found zTXt '${keyword}' but failed to decompress/parse.`, e);
            }
        }
    } else if (type === 'iTXt') {
        // iTXt format: Keyword + null + CompFlag + CompMethod + LangTag + null + TransKey + null + Text
        let nullIndex1 = -1;
        for (let i = chunkDataStart; i < chunkDataEnd; i++) {
            if (uint8Array[i] === 0) {
                nullIndex1 = i;
                break;
            }
        }

        if (nullIndex1 !== -1) {
            const keyword = readText(uint8Array, chunkDataStart, nullIndex1 - chunkDataStart);
            const lowerKeyword = keyword.toLowerCase();

            const compFlag = uint8Array[nullIndex1 + 1];
            // Skip LangTag and TransKey (find next 2 nulls)
            let current = nullIndex1 + 3;
            let nullCount = 0;
            let textStart = -1;
            
            while (current < chunkDataEnd) {
                if (uint8Array[current] === 0) {
                    nullCount++;
                    if (nullCount === 2) {
                        textStart = current + 1;
                        break;
                    }
                }
                current++;
            }

            if (textStart !== -1 && textStart < chunkDataEnd) {
                const rawData = uint8Array.slice(textStart, chunkDataEnd);
                let textData = "";
                
                try {
                    if (compFlag === 1) {
                        // Compressed
                        textData = await decompressZlib(rawData);
                    } else {
                        // Uncompressed
                        textData = readText(uint8Array, textStart, chunkDataEnd - textStart);
                    }

                    if (textData.length > 10) {
                        // Store for fallback
                        potentialJsonChunks.push(textData);

                        if (['chara', 'character', 'ccv3', 'tavern', 'sillytavern'].includes(lowerKeyword)) {
                            try {
                                const decoded = decodeBase64Utf8(textData);
                                characterData = JSON.parse(decoded);
                            } catch (e) {
                                 // Fallback: maybe it's not base64?
                                 try {
                                     characterData = JSON.parse(textData);
                                 } catch (e2) {
                                     // ignore
                                 }
                            }
                        }
                    }
                } catch (e) {
                    // ignore decompression errors
                }
            }
        }
    }

    // Move to next chunk (Data length + 4 bytes for CRC)
    offset += length + 4;
  }

  // Fallback: If no standard keyword matched, try any chunk that looked like JSON
  if (!characterData && potentialJsonChunks.length > 0) {
      console.log("No standard keyword found, trying fallback chunks...");
      for (const chunk of potentialJsonChunks) {
          try {
              // Try as base64 first
              const decoded = decodeBase64Utf8(chunk);
              const data = JSON.parse(decoded);
              if (data.name !== undefined || data.data?.name !== undefined || data.char_name !== undefined || data.data?.char_name !== undefined) {
                  characterData = data;
                  break;
              }
          } catch (e) {
              // Try as raw JSON
              try {
                  const data = JSON.parse(chunk);
                  if (data.name !== undefined || data.data?.name !== undefined || data.char_name !== undefined || data.data?.char_name !== undefined) {
                      characterData = data;
                      break;
                  }
              } catch (e2) {}
          }
      }
  }

  if (!characterData) {
    throw new Error("未在此图片中找到角色数据。请确保这是标准的 Tavern PNG 角色卡。");
  }

  // Handle V2 and V3 Spec (data nested in 'data' property)
  let finalData = characterData;
  if ((characterData.spec === 'chara_card_v2' || characterData.spec === 'chara_card_v3') && characterData.data) {
      finalData = characterData.data;
  } else if (characterData.data && characterData.name === undefined && characterData.char_name === undefined) {
      // Fallback: if 'data' exists but 'name' is missing at root, assume it's V2-like
      finalData = characterData.data;
  }

  // Sanitize character_book to prevent crashes
  if (finalData.character_book && (!finalData.character_book.entries || !Array.isArray(finalData.character_book.entries))) {
      finalData.character_book.entries = [];
  }

  // Create Object URL for the image to use as avatar
  const avatarUrl = URL.createObjectURL(file);
  const id = crypto.randomUUID();
  await saveImage(id, file);

  // Handle tags format
  let parsedTags: string[] = [];
  if (Array.isArray(finalData.tags)) {
      parsedTags = finalData.tags;
  } else if (typeof finalData.tags === 'string') {
      parsedTags = finalData.tags.split(',').map((t: string) => t.trim()).filter(Boolean);
  }

  return {
    id: id,
    name: finalData.name || finalData.char_name || "Unknown",
    description: finalData.description || "",
    personality: finalData.personality || "",
    firstMessage: finalData.first_mes || finalData.firstMessage || finalData.intro || finalData.greeting || "Hello.",
    alternate_greetings: finalData.alternate_greetings || finalData.alternate_greeting || [], 
    scenario: finalData.scenario || "",
    character_book: finalData.character_book,
    tags: parsedTags, 
    avatarUrl: avatarUrl,
    qrList: finalData.qrList || [],
    originalFilename: file.name,
    sourceUrl: finalData.sourceUrl || "",
    creator_notes: finalData.creator_notes || finalData.creatorcomment || "",
    importDate: Date.now(),
    fileLastModified: file.lastModified || undefined,
    extra_qr_data: finalData.extra_qr_data,
    _rawCardData: characterData, // 保存完整原始数据（含spec/spec_version/data及所有字段）
    importFormat: 'png'
  };
};

export const parseCharacterJson = async (file: File): Promise<Character> => {
    const text = await file.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw new Error("Invalid JSON file");
    }

    // Handle V2 and V3 Spec
    let finalData = data;
    if ((data.spec === 'chara_card_v2' || data.spec === 'chara_card_v3') && data.data) {
        finalData = data.data;
    } else if (data.data && data.name === undefined && data.char_name === undefined) {
        finalData = data.data;
    }

    // Sanitize character_book to prevent crashes
    if (finalData.character_book && (!finalData.character_book.entries || !Array.isArray(finalData.character_book.entries))) {
        finalData.character_book.entries = [];
    }

    // Handle tags format
    let parsedTags: string[] = [];
    if (Array.isArray(finalData.tags)) {
        parsedTags = finalData.tags;
    } else if (typeof finalData.tags === 'string') {
        parsedTags = finalData.tags.split(',').map((t: string) => t.trim()).filter(Boolean);
    }

    const id = crypto.randomUUID();
    // Use a default placeholder or try to use a provided image URL if valid (unlikely to be local)
    // We will use a placeholder and NOT save to IDB yet (or save the placeholder?)
    // Let's use a placeholder.
    const avatarUrl = `https://picsum.photos/seed/${id}/400/400`; 

    return {
        id: id,
        name: finalData.name || finalData.char_name || "Unknown",
        description: finalData.description || "",
        personality: finalData.personality || "",
        firstMessage: finalData.first_mes || finalData.firstMessage || finalData.intro || finalData.greeting || "Hello.",
        alternate_greetings: finalData.alternate_greetings || finalData.alternate_greeting || [],
        scenario: finalData.scenario || "",
        character_book: finalData.character_book,
        tags: parsedTags,
        avatarUrl: avatarUrl,
        qrList: finalData.qrList || [],
        originalFilename: file.name,
        sourceUrl: finalData.sourceUrl || "",
        creator_notes: finalData.creator_notes || finalData.creatorcomment || "",
        importDate: Date.now(),
        fileLastModified: file.lastModified || undefined,
        extra_qr_data: finalData.extra_qr_data,
        _rawCardData: data, // 保存完整原始数据（含spec/spec_version/顶层遗留字段等）
        importFormat: 'json'
    };
};

export const parseQrFile = async (file: File): Promise<{ list: any[], raw: any }> => {
  const text = await file.text();
  try {
    const data = JSON.parse(text);

    // 识别：如果是角色卡 JSON（有 spec 字段），拒绝作为 QR 导入
    if (data && (data.spec === 'chara_card_v2' || data.spec === 'chara_card_v3')) {
      throw new Error("这是角色卡 JSON 文件，不是 QR 配置文件。请通过「导入文件」按钮导入角色卡。");
    }
    // 识别：有 name/description/first_mes 等角色卡特征字段，也拒绝
    if (data && (data.first_mes !== undefined || data.char_name !== undefined)) {
      throw new Error("检测到角色卡数据，不是 QR 配置文件。请通过「导入文件」按钮导入角色卡。");
    }

    if (data && Array.isArray(data.qrList)) {
      return { list: data.qrList, raw: data };
    }
    if (Array.isArray(data)) {
      return { list: data, raw: { qrList: data } };
    }
    throw new Error("无效的 QR 配置文件: 未找到 qrList 数组");
  } catch (e: any) {
    throw new Error(e.message.startsWith("无效") || e.message.startsWith("这是") || e.message.startsWith("检测") 
      ? e.message 
      : "解析 QR 配置文件失败: " + e.message);
  }
};

export const exportQrData = (qrList: any[], extraData: any = {}) => {
    // 优先使用 extraData 里保存的原始完整 qrList（包含所有ST字段）
    // 如果没有，才用传入的 qrList
    const finalQrList = (extraData.qrList && extraData.qrList.length > 0) ? extraData.qrList : qrList;
    const { qrList: _removed, ...restExtra } = extraData; // 剥离 extraData 里的 qrList，避免重复
    const exportData = {
        version: 2,
        name: "QR Export",
        disableSend: false,
        placeBeforeInput: false,
        injectInput: false,
        color: "rgba(0, 0, 0, 0)",
        onlyBorderColor: false,
        ...restExtra,
        qrList: finalQrList
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `qr_export_${Date.now()}.json`);
};

export const createTavernPng = async (character: Character): Promise<Blob> => {
  // 1. Load image onto canvas
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = character.avatarUrl;

  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error("无法加载图片，可能是跨域问题。请先上传一张本地图片作为头像。"));
  });

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("Canvas context failed");
  ctx.drawImage(img, 0, 0);

  // 2. Convert to Blob
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error("Failed to create PNG blob");

  const arrayBuffer = await blob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  // 3. Prepare Metadata
  // 优先从 _rawCardData 还原原始结构，只覆盖用户可能在管理器中编辑的字段
  const raw = character._rawCardData;
  let exportData: any;

  if (raw) {
    // 有原始数据：以原始结构为基础，覆盖用户可编辑的字段
    const isV2orV3 = raw.spec === 'chara_card_v2' || raw.spec === 'chara_card_v3';
    if (isV2orV3 && raw.data) {
      // V2/V3 格式：更新 data 内的字段
      exportData = {
        ...raw,
        data: {
          ...raw.data,
          name: character.name,
          description: character.description,
          personality: character.personality,
          first_mes: character.firstMessage,
          alternate_greetings: character.alternate_greetings,
          scenario: character.scenario,
          character_book: character.character_book,
          tags: character.tags,
          creator_notes: character.creator_notes || raw.data.creator_notes || "",
          qrList: (character.extra_qr_data?.qrList?.length > 0) ? character.extra_qr_data.qrList : character.qrList,
        }
      };
    } else {
      // 旧版平铺格式
      exportData = {
        ...raw,
        name: character.name,
        description: character.description,
        personality: character.personality,
        first_mes: character.firstMessage,
        alternate_greetings: character.alternate_greetings,
        scenario: character.scenario,
        character_book: character.character_book,
        tags: character.tags,
        creator_notes: character.creator_notes || raw.creator_notes || "",
        qrList: (character.extra_qr_data?.qrList?.length > 0) ? character.extra_qr_data.qrList : character.qrList,
      };
    }
  } else {
    // 没有原始数据（新建卡或旧数据）：用标准 V2 格式
    exportData = {
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: character.name,
        description: character.description,
        personality: character.personality,
        first_mes: character.firstMessage,
        alternate_greetings: character.alternate_greetings,
        scenario: character.scenario,
        character_book: character.character_book,
        tags: character.tags,
        mes_example: "",
        creator_notes: character.creator_notes || "",
        system_prompt: "",
        post_history_instructions: "",
        creator: "",
        character_version: "",
        extensions: {},
        qrList: (character.extra_qr_data?.qrList?.length > 0) ? character.extra_qr_data.qrList : character.qrList,
        sourceUrl: character.sourceUrl,
      }
    };
  }

  const jsonStr = JSON.stringify(exportData);
  const base64Data = encodeBase64Utf8(jsonStr);
  const key = "chara";
  
  // 4. Construct tEXt chunk
  const keywordBytes = new TextEncoder().encode(key);
  const textBytes = new TextEncoder().encode(base64Data);
  const chunkLength = keywordBytes.length + 1 + textBytes.length;
  
  const chunkBuffer = new Uint8Array(4 + 4 + chunkLength + 4);
  const view = new DataView(chunkBuffer.buffer);

  view.setUint32(0, chunkLength);
  chunkBuffer.set([116, 69, 88, 116], 4);
  chunkBuffer.set(keywordBytes, 8);
  chunkBuffer[8 + keywordBytes.length] = 0;
  chunkBuffer.set(textBytes, 8 + keywordBytes.length + 1);

  const crcInput = chunkBuffer.slice(4, 4 + 4 + chunkLength);
  const crc = crc32(crcInput);
  view.setUint32(4 + 4 + chunkLength, crc);

  // 5. Insert Chunk
  let iendOffset = -1;
  const len = uint8Array.length;
  for (let i = 0; i < len - 7; i++) {
    if (uint8Array[i] === 0x49 && uint8Array[i+1] === 0x45 && uint8Array[i+2] === 0x4e && uint8Array[i+3] === 0x44) {
       iendOffset = i - 4;
       break;
    }
  }

  if (iendOffset === -1) throw new Error("Invalid PNG: No IEND found");

  const finalBuffer = new Uint8Array(uint8Array.length + chunkBuffer.length);
  finalBuffer.set(uint8Array.slice(0, iendOffset), 0);
  finalBuffer.set(chunkBuffer, iendOffset);
  finalBuffer.set(uint8Array.slice(iendOffset), iendOffset + chunkBuffer.length);

  return new Blob([finalBuffer], { type: 'image/png' });
};

export const exportCharacterData = async (character: Character, format: 'json' | 'png', forceZip: boolean = false) => {
  // Use original filename if available, otherwise generate safe name
  let filenameBase = character.originalFilename 
      ? character.originalFilename.replace(/\.[^/.]+$/, "") 
      : character.name.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_').toLowerCase();

  // 1. Single Export (No Zip)
  if (!forceZip) {
      if (format === 'png') {
          try {
              const blob = await createTavernPng(character);
              downloadBlob(blob, `${filenameBase}.png`);
          } catch (e: any) {
              alert(`导出 PNG 失败: ${e.message}`);
          }
      } else {
          const jsonExport = buildJsonExport(character);
          const blob = new Blob([JSON.stringify(jsonExport, null, 2)], { type: 'application/json' });
          downloadBlob(blob, `${filenameBase}.json`);
      }
      return;
  }

  // 2. Zip Export (Package: Card + QR at root of zip)
  const zip = new JSZip();
  
  if (format === 'png') {
      try {
          const blob = await createTavernPng(character);
          zip.file(`${filenameBase}.png`, blob);
      } catch (e: any) {
          console.error("Failed to create PNG for zip", e);
          const jsonExport = buildJsonExport(character);
          zip.file(`${filenameBase}.json`, JSON.stringify(jsonExport, null, 2));
      }
  } else {
      const jsonExport = buildJsonExport(character);
      zip.file(`${filenameBase}.json`, JSON.stringify(jsonExport, null, 2));
  }

  if (character.qrList && character.qrList.length > 0) {
      const extra = character.extra_qr_data || {};
      const { qrList: _removed, ...restExtra } = extra;
      const finalQrList = (extra.qrList && extra.qrList.length > 0) ? extra.qrList : character.qrList;
      const qrExportData = {
        version: 2,
        name: `${character.name} QR`,
        ...restExtra,
        qrList: finalQrList
      };
      zip.file(`${filenameBase}_qr.json`, JSON.stringify(qrExportData, null, 2));
  }

  const content = await zip.generateAsync({ type: "blob" });
  downloadBlob(content, `${filenameBase}.zip`);
};

export const exportBulkCharacters = async (characters: Character[], collections: string[] = []) => {
    const zip = new JSZip();
    const timestamp = new Date().toISOString().slice(0,10);
    
    for (const char of characters) {
        // 1. Determine Filename
        let filename = char.originalFilename;
        if (!filename) {
            const ext = char.importFormat === 'json' ? 'json' : 'png';
            const safeName = char.name.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_').toLowerCase();
            filename = `${safeName}.${ext}`;
        }

        // Ensure filename has correct extension based on format
        const isPng = filename.toLowerCase().endsWith('.png');
        const isJson = filename.toLowerCase().endsWith('.json');
        
        // If import format mismatch with filename extension, trust importFormat? 
        // Or just trust filename? Let's trust importFormat if available, otherwise filename.
        // Actually, user said "import what export what".
        // If importFormat is 'png', we export PNG.
        
        let fileData: Blob | string;
        let finalFilename = filename;

        if (char.importFormat === 'json') {
            fileData = JSON.stringify(buildJsonExport(char), null, 2);
            if (!isJson) finalFilename = filename.replace(/\.[^/.]+$/, "") + ".json";
        } else {
            // Default to PNG
            try {
                fileData = await createTavernPng(char);
                if (!isPng) finalFilename = filename.replace(/\.[^/.]+$/, "") + ".png";
            } catch (e) {
                console.error(`Failed to create PNG for ${char.name}, falling back to JSON`, e);
                fileData = JSON.stringify(buildJsonExport(char), null, 2);
                finalFilename = filename.replace(/\.[^/.]+$/, "") + ".json";
            }
        }

        // 2. Determine Folder Path
        // Priority: Collection > (QR + Card) > Single Card
        
        // Find collection folder
        let collectionFolder = "";
        if (char.tags) {
            const foundCollection = char.tags.find(t => collections.includes(t));
            if (foundCollection) {
                collectionFolder = foundCollection;
            }
        }

        // Check for QR
        const hasQr = char.qrList && char.qrList.length > 0;
        
        let targetFolder = zip;
        if (collectionFolder) {
            targetFolder = zip.folder(collectionFolder) || zip;
        }

        if (hasQr) {
            const charFolderName = finalFilename.replace(/\.[^/.]+$/, "");
            const charFolder = targetFolder.folder(charFolderName);
            
            if (charFolder) {
                charFolder.file(finalFilename, fileData);
                
                const extra = char.extra_qr_data || {};
                const { qrList: _removed, ...restExtra } = extra;
                const finalQrList = (extra.qrList && extra.qrList.length > 0) ? extra.qrList : char.qrList;
                const qrExportData = {
                    version: 2,
                    name: `${char.name} QR`,
                    ...restExtra,
                    qrList: finalQrList
                };
                const qrFilename = finalFilename.replace(/\.[^/.]+$/, "") + "_qr.json";
                charFolder.file(qrFilename, JSON.stringify(qrExportData, null, 2));
            }
        } else {
            // Single card, put directly in collection folder (or root)
            targetFolder.file(finalFilename, fileData);
        }
    }

    const content = await zip.generateAsync({ type: "blob" });
    downloadBlob(content, `tavern_export_${timestamp}.zip`);
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// CRC32 Table
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) {
      c = 0xedb88320 ^ (c >>> 1);
    } else {
      c = c >>> 1;
    }
  }
  crcTable[n] = c;
}

const crc32 = (buf: Uint8Array): number => {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return crc ^ 0xffffffff;
};

const encodeBase64Utf8 = (str: string): string => {
  const bytes = new TextEncoder().encode(str);
  const binString = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binString);
};