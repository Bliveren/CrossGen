export interface GenerationPromptFileEntry {
  line: number;
  prompt: string;
  folderId?: string;
  providerId?: string;
  model?: string;
  idempotencyKey?: string;
  maxAttempts?: number;
  timeoutMs?: number;
  size?: string;
  quality?: string;
  aspectRatio?: string;
  resolution?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function optionalPositiveInteger(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (value === undefined || value === null || value === "") continue;
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
    throw new Error(`${key} must be a positive integer.`);
  }
  return undefined;
}

function parseJsonLine(line: string, lineNumber: number): GenerationPromptFileEntry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Line ${lineNumber} is not valid JSON: ${message}`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`Line ${lineNumber} must be a JSON object with a prompt field.`);
  }
  const prompt = optionalString(parsed, "prompt");
  if (!prompt) {
    throw new Error(`Line ${lineNumber} is missing required string field prompt.`);
  }
  return {
    line: lineNumber,
    prompt,
    folderId: optionalString(parsed, "folderId", "folder"),
    providerId: optionalString(parsed, "providerId", "provider"),
    model: optionalString(parsed, "model"),
    idempotencyKey: optionalString(parsed, "idempotencyKey", "idempotency_key"),
    maxAttempts: optionalPositiveInteger(parsed, "maxAttempts", "max_attempts"),
    timeoutMs: optionalPositiveInteger(parsed, "timeoutMs", "timeout_ms"),
    size: optionalString(parsed, "size"),
    quality: optionalString(parsed, "quality"),
    aspectRatio: optionalString(parsed, "aspectRatio", "aspect_ratio"),
    resolution: optionalString(parsed, "resolution")
  };
}

export function parseGenerationPromptFile(raw: string): GenerationPromptFileEntry[] {
  const entries: GenerationPromptFileEntry[] = [];
  const lines = raw.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const trimmed = lines[index].trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    entries.push(trimmed.startsWith("{") ? parseJsonLine(trimmed, lineNumber) : { line: lineNumber, prompt: trimmed });
  }
  if (entries.length === 0) {
    throw new Error("Prompt file does not contain any prompts.");
  }
  return entries;
}
