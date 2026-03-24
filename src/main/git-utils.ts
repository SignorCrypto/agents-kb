import type { GitRef } from '../shared/types';

export function parseRefs(refStr: string): GitRef[] {
  if (!refStr.trim()) return [];
  return refStr.split(',').map((r) => r.trim()).filter(Boolean).map((raw) => {
    if (raw.startsWith('HEAD -> ')) {
      return { name: raw.replace('HEAD -> ', ''), type: 'head' as const };
    }
    if (raw.startsWith('tag: ')) {
      return { name: raw.replace('tag: ', ''), type: 'tag' as const };
    }
    if (raw === 'HEAD') {
      return { name: 'HEAD', type: 'head' as const };
    }
    if (raw.includes('/')) {
      return { name: raw, type: 'remote' as const };
    }
    return { name: raw, type: 'branch' as const };
  });
}
