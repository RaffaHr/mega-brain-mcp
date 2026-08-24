import type { z } from 'zod';

import type { runtimeCommandSchema } from './lock-manifest.js';

export type RuntimeCommand = z.infer<typeof runtimeCommandSchema>;
