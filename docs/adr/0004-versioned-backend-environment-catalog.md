# 0004. Versioned Backend Environment Catalog and Explicit Consumers

Date: 2026-08-30

We decided to maintain a versioned Mega Brain catalog for AgentMemory and Code Review Graph environment settings, validate it against official documentation for each target dependency version, and expose settings through grouped setup sections. The catalog records defaults, unset behavior, allowed values, dependency conditions, secret classification, and consumer mapping; Mega Brain policy deviations remain explicit instead of silently replacing backend behavior. Provider secrets are entered once but delivered only to consumers selected by the user.
