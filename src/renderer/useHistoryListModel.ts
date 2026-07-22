import { useMemo } from "react";
import type { GenerationJob, WorkMode } from "../shared/types";
import type { Language } from "./i18n";

type HistoryStatusFilter = "all" | "succeeded" | "failed";
type HistorySortMode = "newest" | "oldest";

interface HistoryScrollState {
  top: number;
  clientHeight: number;
  scrollHeight: number;
}

interface HistoryModelDetails {
  searchText: string;
}

interface UseHistoryListModelArgs {
  history: GenerationJob[];
  search: string;
  statusFilter: HistoryStatusFilter;
  sort: HistorySortMode;
  language: Language;
  pageSize: number;
  pageIndex: number;
  expanded: boolean;
  scrollState: HistoryScrollState;
  displayNameForJob: (job: GenerationJob) => string;
  systemTagLabelForMode: (mode: WorkMode, language: Language) => string;
  modelDetailsForJob: (job: GenerationJob) => HistoryModelDetails;
}

export function useHistoryListModel({
  history,
  search,
  statusFilter,
  sort,
  language,
  pageSize,
  pageIndex,
  expanded,
  scrollState,
  displayNameForJob,
  systemTagLabelForMode,
  modelDetailsForJob
}: UseHistoryListModelArgs) {
  const filteredHistory = useMemo(() => {
    const query = search.trim().toLowerCase();
    const statusMatched = statusFilter === "all"
      ? history
      : history.filter((job) => job.status === statusFilter);
    const matched = !query
      ? statusMatched
      : statusMatched.filter((job) => {
          const modelDetails = modelDetailsForJob(job);
          const systemTag = systemTagLabelForMode(job.mode, language);
          const haystack = `${displayNameForJob(job)} ${job.tags.join(" ")} ${systemTag} ${job.source ?? ""} ${job.prompt} ${job.mode} ${job.status} ${job.error ?? ""} ${job.createdAt} ${modelDetails.searchText}`.toLowerCase();
          return haystack.includes(query);
        });
    const sorted = [...matched];
    if (sort === "oldest") {
      sorted.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    } else {
      sorted.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    }
    return sorted;
  }, [displayNameForJob, history, language, modelDetailsForJob, search, sort, statusFilter, systemTagLabelForMode]);

  const tagsAvailable = useMemo(() => {
    const tags = new Set<string>();
    history.forEach((job) => job.tags.forEach((tag) => tags.add(tag)));
    return [...tags].sort((a, b) => a.localeCompare(b));
  }, [history]);

  const systemTagsAvailable = useMemo(() => {
    const tags = new Set<string>();
    history.forEach((job) => tags.add(systemTagLabelForMode(job.mode, language)));
    return [...tags].sort((a, b) => a.localeCompare(b));
  }, [history, language, systemTagLabelForMode]);

  const hasOverflow = filteredHistory.length > pageSize;
  const pageCount = Math.max(1, Math.ceil(filteredHistory.length / pageSize));
  const normalizedPageIndex = Math.min(pageIndex, pageCount - 1);
  const pageStartIndex = normalizedPageIndex * pageSize;
  const visibleHistory = expanded ? filteredHistory : filteredHistory.slice(pageStartIndex, pageStartIndex + pageSize);
  const isSearching = search.trim().length > 0;
  const pagerVisible = hasOverflow && (
    scrollState.scrollHeight > scrollState.clientHeight &&
    scrollState.top + scrollState.clientHeight >= scrollState.scrollHeight - 80
  );

  return {
    filteredHistory,
    tagsAvailable,
    systemTagsAvailable,
    hasOverflow,
    pageCount,
    normalizedPageIndex,
    visibleHistory,
    isSearching,
    pagerVisible
  };
}
