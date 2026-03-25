import { useState, useCallback, useRef, useEffect } from 'react';
import { useElectronAPI } from '../../hooks/useElectronAPI';
import type { GitCommit } from '../../types/index';

interface UseGitHistoryReturn {
  commits: GitCommit[];
  loading: boolean;
  hasMore: boolean;
  totalCount: number;
  loadMore: () => void;
  refresh: () => void;
  error: string | null;
}

export function useGitHistory(projectId: string, branch?: string): UseGitHistoryReturn {
  const api = useElectronAPI();
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const pageRef = useRef(0);
  const initializedRef = useRef(false);

  const fetchPage = useCallback(async (page: number, append: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.gitLog(projectId, page, branch);
      if (!result) {
        setError('Failed to load git history');
        setHasMore(false);
        return;
      }
      if (append) {
        setCommits((prev) => [...prev, ...result.commits]);
      } else {
        setCommits(result.commits);
      }
      setHasMore(result.hasMore);
      if (result.totalCount >= 0) setTotalCount(result.totalCount);
    } catch (err) {
      setError('Failed to load git history');
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [api, projectId, branch]);

  const loadMore = useCallback(() => {
    if (loading || !hasMore) return;
    const nextPage = pageRef.current + 1;
    pageRef.current = nextPage;
    fetchPage(nextPage, true);
  }, [loading, hasMore, fetchPage]);

  const refresh = useCallback(() => {
    pageRef.current = 0;
    fetchPage(0, false);
  }, [fetchPage]);

  // Auto-load on first render
  if (!initializedRef.current) {
    initializedRef.current = true;
    fetchPage(0, false);
  }

  // Re-fetch when branch changes
  const prevBranchRef = useRef(branch);
  useEffect(() => {
    if (prevBranchRef.current !== branch) {
      prevBranchRef.current = branch;
      pageRef.current = 0;
      fetchPage(0, false);
    }
  }, [branch, fetchPage]);

  return { commits, loading, hasMore, totalCount, loadMore, refresh, error };
}
