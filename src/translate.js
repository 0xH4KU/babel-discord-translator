import { store } from './store.js';

/**
 * Translate text using Vertex AI Gemini REST API.
 * Returns { text, inputTokens, outputTokens }.
 */
export async function translate(text) {
    const model = store.get('geminiModel');
    const project = store.get('gcpProject');
    const location = store.get('gcpLocation');
    const apiKey = store.get('vertexAiApiKey');

    if (!project || !apiKey) {
        throw new Error('API not configured. Please complete setup in the dashboard.');
    }

    const baseUrl =
        location === 'global'
            ? 'https://aiplatform.googleapis.com'
            : `https://${location}-aiplatform.googleapis.com`;

    const url = `${baseUrl}/v1beta1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;

    const prompt = `You are a translator. Detect the language of the following text and translate it.

Rules:
- If the text is Chinese (Traditional or Simplified) → translate to English
- If the text is English → translate to Traditional Chinese (繁體中文)
- If the text contains both Chinese and English → translate each part to the other language
- If the text is in another language → translate to both English and Traditional Chinese
- Output ONLY the translation. No explanations, no labels, no extra text.
- Preserve the original formatting (line breaks, punctuation, etc.)

Text:
${text}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                maxOutputTokens: 1000,
                temperature: 0.1,
            },
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Vertex AI ${response.status}: ${error}`);
    }

    const data = await response.json();
    const result = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!result) {
        throw new Error('Empty response from Gemini');
    }

    // Extract token usage from response
    const meta = data.usageMetadata || {};

    return {
        text: result,
        inputTokens: meta.promptTokenCount || 0,
        outputTokens: meta.candidatesTokenCount || 0,
    };
}
