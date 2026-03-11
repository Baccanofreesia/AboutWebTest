/**
 * Safe API response parsing utilities.
 *
 * Prevents "Unexpected token <" crashes that happen when API proxies
 * return HTML error pages (CloudFlare, nginx 502/503, rate limits)
 * instead of JSON responses.
 */

/** Parse a fetch Response as JSON safely (text-first, then JSON.parse) */
export async function safeResponseJson(response: Response): Promise<any> {
    const text = await response.text();

    // Detect HTML / XML responses
    const trimmed = text.trimStart();
    if (trimmed.startsWith('<')) {
        // Extract useful info from HTML error pages
        const titleMatch = trimmed.match(/<title>(.*?)<\/title>/i);
        const hint = titleMatch ? titleMatch[1] : trimmed.slice(0, 120);
        throw new Error(
            `API返回了HTML而非JSON (HTTP ${response.status}): ${hint}`
        );
    }

    // Empty body
    if (!trimmed) {
        throw new Error(`API返回了空响应 (HTTP ${response.status})`);
    }

    try {
        return JSON.parse(text);
    } catch (e) {
        // Show a snippet of what we got for debugging
        const preview = text.slice(0, 200);
        throw new Error(
            `API返回了无效JSON (HTTP ${response.status}): ${preview}`
        );
    }
}

/**
 * Fetch with automatic retry for transient errors.
 * Retries on: 429, 500, 502, 503, 504 and network failures.
 * Returns the parsed JSON data directly.
 */
export async function safeFetchJson(
    url: string,
    options: RequestInit,
    maxRetries: number = 2
): Promise<any> {
    const retryableStatuses = new Set([429, 500, 502, 503, 504]);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, options);

            if (!response.ok) {
                // For retryable status codes, retry before giving up
                if (retryableStatuses.has(response.status) && attempt < maxRetries) {
                    const delay = Math.pow(2, attempt) * 1000; // 1s, 2s
                    console.warn(`[SafeAPI] HTTP ${response.status}, retry ${attempt + 1}/${maxRetries} in ${delay}ms...`);
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                }
                // Non-retryable or last attempt: parse body for error details
                const data = await safeResponseJson(response);
                // If we somehow got valid JSON with error info, wrap it
                const errMsg = data?.error?.message || data?.error || `HTTP ${response.status}`;
                throw new Error(`API Error ${response.status}: ${errMsg}`);
            }

            return await safeResponseJson(response);
        } catch (e: any) {
            lastError = e;

            // Network errors (fetch itself failed) are retryable
            if (e.name === 'TypeError' && attempt < maxRetries) {
                const delay = Math.pow(2, attempt) * 1000;
                console.warn(`[SafeAPI] Network error, retry ${attempt + 1}/${maxRetries} in ${delay}ms:`, e.message);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }

            // For HTML/parse errors on non-ok responses during retry, continue
            if (attempt < maxRetries && e.message?.includes('API返回了HTML')) {
                const delay = Math.pow(2, attempt) * 1000;
                console.warn(`[SafeAPI] HTML response, retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }

            throw e;
        }
    }

    throw lastError || new Error('API请求失败');
}

/**
 * Safely extract the AI content string from an OpenAI-compatible response.
 * Returns '' instead of crashing when the structure is unexpected.
 */
export function extractContent(data: any): string {
    return data?.choices?.[0]?.message?.content?.trim() || '';
}

/**
 * Robustly extract a JSON object from AI-generated text.
 *
 * Handles common Claude format instabilities:
 *  - JSON wrapped in ```json ... ``` code blocks
 *  - Extra prose before/after the JSON ("Here is the result: { ... }")
 *  - Trailing commas in arrays/objects  (common Claude habit)
 *  - Single-quoted strings
 *  - Unquoted keys
 *
 * Returns parsed object on success, null on total failure.
 */
export function extractJson(raw: string): any | null {
    if (!raw) return null;

    // 1. Strip markdown code fences
    let text = raw
        .replace(/^```(?:json|JSON)?\s*\n?/gm, '')
        .replace(/\n?```\s*$/gm, '')
        .trim();

    // 2. Try direct parse first (fast path)
    try { return JSON.parse(text); } catch {}

    // 3. Extract the outermost { ... } or [ ... ]
    const objMatch = text.match(/(\{[\s\S]*\})/);
    const arrMatch = text.match(/(\[[\s\S]*\])/);
    // Prefer whichever starts earlier in the text
    let jsonStr = '';
    if (objMatch && arrMatch) {
        jsonStr = (text.indexOf(objMatch[1]) <= text.indexOf(arrMatch[1]))
            ? objMatch[1] : arrMatch[1];
    } else {
        jsonStr = objMatch?.[1] || arrMatch?.[1] || '';
    }

    if (!jsonStr) return null;

    // 4. Try parsing the extracted substring
    try { return JSON.parse(jsonStr); } catch {}

    // 5. Fix common AI formatting issues and retry
    let fixed = jsonStr
        // Trailing commas: ,} or ,]
        .replace(/,\s*([}\]])/g, '$1')
        // Single quotes → double quotes (careful with apostrophes in text)
        // Only replace quotes that look like JSON string delimiters
        .replace(/'/g, '"')
        // Unquoted keys:  { foo: "bar" } → { "foo": "bar" }
        .replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":');

    try { return JSON.parse(fixed); } catch {}

    // 6. Last resort: try to extract individual JSON objects if there are multiple
    // (AI sometimes outputs two JSON blocks, take the larger one)
    const allObjects = [...text.matchAll(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g)];
    if (allObjects.length > 0) {
        // Sort by length, try the longest first (most likely the full response)
        const sorted = allObjects.sort((a, b) => b[0].length - a[0].length);
        for (const m of sorted) {
            try {
                return JSON.parse(m[0].replace(/,\s*([}\]])/g, '$1'));
            } catch {}
        }
    }

    console.error('[extractJson] All attempts failed. Raw:', raw.slice(0, 300));
    return null;
}
