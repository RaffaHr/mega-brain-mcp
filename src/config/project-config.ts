import {
  loadConfigWithSources,
  redactConfig,
  type ConfigSource,
  type LoadConfigOptions,
} from './load.js';
import type { MegaBrainConfig } from './schema.js';

export interface ResolvedProjectConfig {
  config: Readonly<MegaBrainConfig>;
  sources: Readonly<Record<string, ConfigSource>>;
  diagnostic: Readonly<{
    config: Readonly<Record<string, unknown>>;
    sources: Readonly<Record<string, ConfigSource>>;
  }>;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export async function resolveProjectConfig(options: LoadConfigOptions = {}): Promise<ResolvedProjectConfig> {
  const loaded = await loadConfigWithSources(options);
  const sources = deepFreeze({ ...loaded.sources });
  const config = deepFreeze(loaded.config);
  const diagnostic = deepFreeze({ config: redactConfig(loaded.config), sources });
  return deepFreeze({ config, sources, diagnostic });
}
