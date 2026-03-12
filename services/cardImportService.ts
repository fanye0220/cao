import { Character } from "../types";
import JSZip from "jszip";
import { saveImage, loadImage } from "./imageService";

/**
 * 将内部 Character 对象还原为标准 ST 角色卡 JSON 格式。
 * 优先使用 _rawCardData 还原原始结构，只覆盖用户编辑过的字段。
 * 这样可以保留 extensions、creator、character_version 等所有原始字段。
 */
const buildJsonExport = (character: Character): any => {
  const raw = character._rawCardData;

  if (raw) {
    const isV2orV3 = raw.spec === 'chara_card_v2' || raw.spec === 'chara_card_v3';
    if (isV2orV3 && raw.data) {
      // V2/V3：更新用户可编辑字段，其余原样保留，移除qrList（QR是独立文件）
      const { qrList: _rq, ...restData } = raw.data;
      return {
        ...raw,
        data: {
          ...restData,
          name: character.name,
          description: character.description,
          personality: character.personality,
          first_mes: character.firstMessage,
          alternate_greetings: character.alternate_greetings,
          scenario: character.scenario,
          character_book: character.character_book,
          tags: character.tags,
          creator_notes: character.creator_notes ?? raw.data.creator_notes ?? "",
          note: character.note ?? restData.note ?? "", // 同步 note 字段（对应 HTML 版 card.note）
        }
      };
    } else {
      // 旧版平铺格式
      const { qrList: _rq, ...restRaw } = raw;
      return {
        ...restRaw,
        name: character.name,
        description: character.description,
        personality: character.personality,
        first_mes: character.firstMessage,
        alternate_greetings: character.alternate_greetings,
        scenario: character.scenario,
        character_book: character.character_book,
        tags: character.tags,
        creator_notes: character.creator_notes ?? raw.creator_notes ?? "",
        note: character.note ?? restRaw.note ?? "", // 同步 note 字段
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
      note: character.note || "", // 备注字段
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
    note: finalData.note || "", // 备注字段，对应 HTML 版 card.note
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
    // JSON 导入没有附带图片，avatarUrl 设为空字符串
    // 用户需在编辑页面手动上传头像才能导出为 PNG
    const avatarUrl = ``;

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
        note: finalData.note || "", // 备注字段，对应 HTML 版 card.note
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

export const exportQrData = (qrList: any[], extraData: any = {}, originalFilename?: string) => {
    // 完全用原始数据还原，只用传入qrList作为fallback
    const finalQrList = (extraData.qrList && extraData.qrList.length > 0) ? extraData.qrList : qrList;
    const { qrList: _removed, ...restExtra } = extraData;
    const exportData = {
        version: 2,
        name: "QR Export",
        disableSend: false,
        placeBeforeInput: false,
        injectInput: false,
        color: "rgba(0, 0, 0, 0)",
        onlyBorderColor: false,
        ...restExtra,   // 原始数据覆盖默认值（含原始name、injectInput等所有字段）
        qrList: finalQrList
    };
    // 文件名：用原始导入文件名，没有则用原始name字段，再没有才用时间戳
    const filename = originalFilename || 
        (restExtra.name ? `${restExtra.name}.json` : `qr_export_${Date.now()}.json`);
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    downloadBlob(blob, filename);
};

/**
 * 将图片 ArrayBuffer 转为纯 PNG 字节（若已是 PNG 则原样返回，
 * 若是 JPEG/WebP 等则通过 canvas 转换为 PNG）。
 */
const ensurePngBuffer = async (blob: Blob): Promise<Uint8Array> => {
  const ab = await blob.arrayBuffer();
  const header = new Uint8Array(ab, 0, 8);
  const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  const isAlreadyPng = PNG_SIG.every((b, i) => header[i] === b);
  if (isAlreadyPng) return new Uint8Array(ab);

  // 非 PNG（如 JPEG）：通过 canvas 转为 PNG
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("无法解码图片"));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const pngBlob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'));
    if (!pngBlob) throw new Error("Canvas toBlob failed");
    return new Uint8Array(await pngBlob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
};

export const createTavernPng = async (character: Character): Promise<Blob> => {
  // 1. 优先从 IndexedDB 取原始文件 blob（PNG/JSON 导入时均已存图）
  let uint8Array: Uint8Array;

  const originalBlob = await loadImage(character.id).catch(() => undefined);

  if (originalBlob) {
    // 原始文件存在：直接用原始字节（PNG 原样，JPEG 则转为 PNG）
    uint8Array = await ensurePngBuffer(originalBlob);
  } else {
    // 没有 IDB 图片（JSON 导入 + 未手动上传头像）：尝试从 avatarUrl 加载
    if (!character.avatarUrl) {
      throw new Error("该角色通过 JSON 导入，尚未上传头像。请先在编辑页面点击头像区域上传一张本地图片，再导出 PNG。");
    }
    let sourceBlob: Blob | undefined;
    try {
      const resp = await fetch(character.avatarUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      sourceBlob = await resp.blob();
    } catch {
      // 如果 avatarUrl 是占位图（picsum）也加载失败，给出明确提示
      const isPlaceholder = character.avatarUrl?.includes('picsum.photos');
      throw new Error(
        isPlaceholder
          ? "该角色通过 JSON 导入，尚未上传头像。请先在编辑页面点击头像区域上传一张本地图片，再导出 PNG。"
          : "无法加载角色头像图片，请检查网络或重新上传头像。"
      );
    }
    uint8Array = await ensurePngBuffer(sourceBlob);
  }

  // 3. Prepare Metadata — 直接复用 buildJsonExport 保证逻辑一致
  const exportData = buildJsonExport(character);

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

  // 5. Rebuild PNG chunk-by-chunk, stripping existing chara tEXt/iTXt/zTXt chunks
  //    to avoid duplicate chara chunks (ST reads the first it finds — old stale data wins).
  const dv = new DataView(uint8Array.buffer, uint8Array.byteOffset, uint8Array.byteLength);
  const keepChunks: Uint8Array[] = [];
  keepChunks.push(uint8Array.slice(0, 8)); // PNG signature

  let off = 8;
  while (off + 12 <= uint8Array.length) {
    const chunkLen = dv.getUint32(off);
    const chunkType = String.fromCharCode(
      uint8Array[off + 4], uint8Array[off + 5],
      uint8Array[off + 6], uint8Array[off + 7]
    );
    const totalChunkSize = 12 + chunkLen;
    if (chunkType === "IEND") break;

    // Drop any existing chara metadata chunks
    const isCharaChunk = (chunkType === "tEXt" || chunkType === "iTXt" || chunkType === "zTXt") &&
      (() => {
        const dataStart = off + 8;
        let ni = dataStart;
        while (ni < dataStart + chunkLen && uint8Array[ni] !== 0) ni++;
        const kw = new TextDecoder().decode(uint8Array.slice(dataStart, ni));
        return ["chara", "character", "ccv3"].includes(kw.toLowerCase());
      })();

    if (!isCharaChunk) keepChunks.push(uint8Array.slice(off, off + totalChunkSize));
    off += totalChunkSize;
  }

  // Append new tEXt chara chunk + IEND
  const IEND = new Uint8Array([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
  keepChunks.push(chunkBuffer);
  keepChunks.push(IEND);

  return new Blob(keepChunks, { type: 'image/png' });
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
        name: "QR Export",
        disableSend: false,
        placeBeforeInput: false,
        injectInput: false,
        color: "rgba(0, 0, 0, 0)",
        onlyBorderColor: false,
        ...restExtra,   // 原始字段覆盖（含原始name、injectInput等）
        qrList: finalQrList
      };
      // 用原始导入文件名，没有则用原始name字段
      const qrFilename = character.qrFileName || 
          (restExtra.name ? `${restExtra.name}.json` : `${filenameBase}_qr.json`);
      zip.file(qrFilename, JSON.stringify(qrExportData, null, 2));
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
                    name: "QR Export",
                    disableSend: false,
                    placeBeforeInput: false,
                    injectInput: false,
                    color: "rgba(0, 0, 0, 0)",
                    onlyBorderColor: false,
                    ...restExtra,   // 原始字段覆盖（含原始name、injectInput等）
                    qrList: finalQrList
                };
                // 用原始导入文件名，没有则用原始name字段
                const qrFilename = char.qrFileName ||
                    (restExtra.name ? `${restExtra.name}.json` : finalFilename.replace(/\.[^/.]+$/, "") + "_qr.json");
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