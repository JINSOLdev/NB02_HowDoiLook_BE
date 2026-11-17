type StructuredImageRequest = {
  image: Buffer;
  mimeType: string;
  systemPrompt: string;
  userPrompt: string;
  schemaName: string;
  schema: Record<string, unknown>;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
};

export class ModelApiError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'ModelApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Both image analysis and weather recommendations use the same vision API contract.
export async function requestStructuredImageAnalysis(request: StructuredImageRequest): Promise<unknown> {
  const apiKey = process.env.MODEL_API_KEY?.trim();
  if (!apiKey) {
    throw new ModelApiError(503, 'Meta Model API is not configured');
  }

  const signal = AbortSignal.timeout(30_000);
  let response: Response;
  let result: unknown;
  try {
    response = await fetch('https://api.meta.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.MODEL_NAME?.trim() || 'muse-spark-1.3',
        reasoning_effort: request.reasoningEffort,
        messages: [
          { role: 'system', content: request.systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: request.userPrompt },
              {
                type: 'image_url',
                image_url: { url: `data:${request.mimeType};base64,${request.image.toString('base64')}` },
              },
            ],
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: request.schemaName, strict: true, schema: request.schema },
        },
      }),
      signal,
    });

    if (!response.ok) {
      // Do not expose upstream bodies, which may include request data or credentials.
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) {
        throw new ModelApiError(503, 'Meta Model API key is invalid or inactive');
      }
      if (response.status === 429) {
        throw new ModelApiError(503, 'Meta Model API is temporarily rate-limited');
      }
      throw new ModelApiError(502, `Meta Model API returned HTTP ${response.status}`);
    }

    result = await response.json();
  } catch (error) {
    if (error instanceof ModelApiError) throw error;
    if (signal.aborted || (error instanceof Error && error.name === 'TimeoutError')) {
      throw new ModelApiError(504, 'Meta Model API request timed out');
    }
    if (error instanceof SyntaxError) {
      throw new ModelApiError(502, 'Meta Model API returned invalid data');
    }
    throw new ModelApiError(502, 'Could not reach Meta Model API');
  }

  const choice = isRecord(result) && Array.isArray(result.choices) ? result.choices[0] : undefined;
  const message = isRecord(choice) && isRecord(choice.message) ? choice.message : undefined;
  if (typeof message?.content !== 'string' || message.refusal) {
    throw new ModelApiError(502, 'Meta Model API returned no analysis');
  }

  try {
    return JSON.parse(message.content);
  } catch {
    throw new ModelApiError(502, 'Meta Model API returned invalid JSON');
  }
}
