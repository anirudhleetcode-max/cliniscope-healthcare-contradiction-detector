// Provider adapter for AI-assisted reasoning. The API key never leaves the
// server. Responses are schema-validated by the SDK (structured outputs) and
// again by verifyAiOutput() before anything is returned.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { AI_SYSTEM_PROMPT, AiOutputSchema, buildUserPrompt, type AiDocumentInput } from '../src/lib/ai';
import type { ServerConfig } from './config';

export type AiErrorCode = 'not_configured' | 'provider_auth' | 'rate_limited' | 'timeout' | 'unavailable' | 'refused' | 'malformed_output' | 'bad_request';

export class AiProviderError extends Error {
  constructor(public code: AiErrorCode, message: string, public httpStatus: number) { super(message); }
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  analyze(docs: AiDocumentInput[], existing: { title: string; type: string }[]): Promise<unknown>;
}

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  private client: Anthropic;
  constructor(private cfg: Pick<ServerConfig, 'anthropicApiKey' | 'anthropicBaseUrl' | 'aiModel' | 'aiTimeoutMs' | 'aiFallbacks'>) {
    this.client = new Anthropic({ apiKey: cfg.anthropicApiKey!, baseURL: cfg.anthropicBaseUrl, timeout: cfg.aiTimeoutMs, maxRetries: 1 });
  }
  get model(): string { return this.cfg.aiModel; }

  async analyze(docs: AiDocumentInput[], existing: { title: string; type: string }[]): Promise<unknown> {
    try {
      const res = await this.client.beta.messages.parse({
        model: this.cfg.aiModel,
        max_tokens: 16000,
        ...(this.cfg.aiFallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        output_config: { format: betaZodOutputFormat(AiOutputSchema), effort: 'medium' },
        system: AI_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserPrompt(docs, existing) }],
      });
      if (res.stop_reason === 'refusal') throw new AiProviderError('refused', 'The AI provider declined this request. The deterministic analysis is unaffected.', 502);
      if (res.stop_reason === 'max_tokens') throw new AiProviderError('malformed_output', 'The AI response was truncated before it was complete.', 502);
      if (!res.parsed_output) throw new AiProviderError('malformed_output', 'The AI response could not be parsed as the required structure.', 502);
      return res.parsed_output;
    } catch (e) {
      throw mapError(e);
    }
  }
}

export function mapError(e: unknown): AiProviderError {
  if (e instanceof AiProviderError) return e;
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new AiProviderError('timeout', 'The AI provider did not respond in time.', 504);
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return new AiProviderError('provider_auth', 'The AI provider rejected the server credentials. An administrator must check the server configuration.', 502);
  if (e instanceof Anthropic.RateLimitError) return new AiProviderError('rate_limited', 'The AI provider is rate-limiting requests. Try again shortly.', 429);
  if (e instanceof Anthropic.BadRequestError) return new AiProviderError('bad_request', 'The AI provider rejected the request (it may be too large).', 502);
  if (e instanceof Anthropic.APIConnectionError) return new AiProviderError('unavailable', 'The AI provider could not be reached.', 503);
  if (e instanceof Anthropic.APIError) return new AiProviderError('unavailable', `The AI provider returned an error (HTTP ${e.status ?? 'unknown'}).`, 503);
  if (e instanceof SyntaxError || (e instanceof Error && /parse|schema|zod/i.test(e.name + e.message))) return new AiProviderError('malformed_output', 'The AI response did not match the required structure.', 502);
  return new AiProviderError('unavailable', 'AI analysis failed unexpectedly.', 503);
}

export function providerFromConfig(cfg: ServerConfig): AiProvider | null {
  return cfg.anthropicApiKey ? new AnthropicProvider(cfg) : null;
}
