import 'server-only';

import { AnthropicProvider } from './anthropic';
import { DevRouterProvider } from './dev-router';
import { GeminiProvider } from './gemini';
import type { AssistantModelProvider } from './types';

export type ProviderResolution =
  | { ok: true; provider: AssistantModelProvider; developmentMode: boolean }
  | { ok: false; notice: string };

const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5';
// Google's moving alias for its current Flash model.
const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';

/**
 * Chooses the model provider from SERVER-ONLY configuration:
 *
 *   ASSISTANT_PROVIDER   'anthropic' | 'gemini' | 'dev-router' (unset = assistant off)
 *   ANTHROPIC_API_KEY    required for 'anthropic'
 *   GEMINI_API_KEY       required for 'gemini'
 *   ASSISTANT_MODEL      optional model override
 *
 * Opt-in is explicit: an API key lying around in the environment never turns
 * paid usage on by itself. None of these may ever be NEXT_PUBLIC_*.
 */
export function resolveProvider(
  env: Record<string, string | undefined> = process.env
): ProviderResolution {
  const choice = env.ASSISTANT_PROVIDER?.trim().toLowerCase();

  if (!choice) {
    return {
      ok: false,
      notice:
        'The assistant is not switched on in this environment yet. An administrator needs to configure a language model provider (ASSISTANT_PROVIDER) on the server.'
    };
  }

  if (choice === 'dev-router') {
    if (env.NODE_ENV === 'production') {
      return {
        ok: false,
        notice:
          'The development router cannot be used in production. Configure a language model provider.'
      };
    }
    return {
      ok: true,
      provider: new DevRouterProvider(),
      developmentMode: true
    };
  }

  if (choice === 'anthropic') {
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return {
        ok: false,
        notice:
          'The assistant is set to use Anthropic but no ANTHROPIC_API_KEY is configured on the server.'
      };
    }
    return {
      ok: true,
      provider: new AnthropicProvider(
        apiKey,
        env.ASSISTANT_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL
      ),
      developmentMode: false
    };
  }

  if (choice === 'gemini') {
    // GEMENI_API_KEY is the spelling this project's .env already uses; the
    // correctly spelled name wins when both are set.
    const apiKey = (env.GEMINI_API_KEY || env.GEMENI_API_KEY)?.trim();
    if (!apiKey) {
      return {
        ok: false,
        notice:
          'The assistant is set to use Gemini but no GEMINI_API_KEY is configured on the server.'
      };
    }
    return {
      ok: true,
      provider: new GeminiProvider(
        apiKey,
        env.ASSISTANT_MODEL?.trim() || DEFAULT_GEMINI_MODEL
      ),
      developmentMode: false
    };
  }

  return {
    ok: false,
    notice: `Unknown ASSISTANT_PROVIDER "${choice}". Supported: anthropic, gemini, dev-router.`
  };
}
