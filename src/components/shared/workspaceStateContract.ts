export const WORKSPACE_STATE_KINDS = [
  'initial-loading',
  'refreshing',
  'empty-first-use',
  'empty-filtered',
  'error-recoverable',
  'permission',
  'offline',
  'stale',
  'partial',
  'conflict',
  'rate-limited',
  'success',
] as const;

export type WorkspaceStateKind = typeof WORKSPACE_STATE_KINDS[number];
