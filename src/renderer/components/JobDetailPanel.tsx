import { useState, useRef, useMemo, useEffect, useCallback, memo } from 'react';
import { useKanbanStore } from '../hooks/useKanbanStore';
import { useJobOutput, useJobOutputAnalysis } from '../hooks/useJobOutput';
import { useElectronAPI } from '../hooks/useElectronAPI';
import { useShortcut } from '../hooks/useShortcut';
import { useImageAttachment, draftImageToAttachedImage, attachedImageToDraftImage } from '../hooks/useImageAttachment';
import { Kbd } from './Kbd';
import { StreamingLog } from './StreamingLog';
import { DiffViewer } from './DiffViewer';
import { MentionInput, MentionTextarea } from './MentionInput';
import { ImageAttachmentBar } from './ImageAttachmentBar';
import { formatDuration, useNow } from '../utils/duration';
import type { Job, JobImage, JobComposerDraft, PendingQuestionDraft, JobDetailDrafts, FollowUp, AppSettings, PhaseTokenUsage, SubQuestion } from '../types/index';
import { getProjectColor, getThinkingDisplay, normalizeEffortForThinking } from '../types/index';
import { BrainIcon, BranchIcon, StopIcon, TrashIcon, XIcon } from './Icons';
import { CopyButton } from './CopyButton';
import { PlanMarkdown } from './PlanMarkdown';

/* ─── Streaming isolation containers (Step 1) ─── */

const StreamingLogContainer = memo(function StreamingLogContainer({ jobId }: { jobId: string }) {
  const outputLog = useJobOutput(jobId);
  const { sections } = useJobOutputAnalysis(jobId, outputLog);
  return <StreamingLog sections={sections} entryCount={outputLog.length} />;
});

const LiveEditedFilesContainer = memo(function LiveEditedFilesContainer({
  jobId, projectId
}: { jobId: string; projectId: string }) {
  const outputLog = useJobOutput(jobId);
  const { editedFiles } = useJobOutputAnalysis(jobId, outputLog);
  return <EditedFilesList files={editedFiles} projectId={projectId} />;
});

type DraftSectionKey = keyof JobDetailDrafts;

function buildComposerDraft(text: string, images: ReturnType<typeof useImageAttachment>['images']): JobComposerDraft | undefined {
  if (!text.trim() && images.length === 0) return undefined;
  return {
    text,
    images: images.map(attachedImageToDraftImage),
  };
}

function buildPendingQuestionDraft(
  questionId: string | undefined,
  currentStep: number,
  responseText: string,
  selectedOptions: Set<string>,
  questionAnswers: Record<string, string>,
  questionSelections: Record<string, Set<string>>,
): PendingQuestionDraft | undefined {
  if (!questionId) return undefined;

  const normalizedAnswers = Object.fromEntries(
    Object.entries(questionAnswers).filter(([, value]) => !!value?.trim()),
  );
  const normalizedSelections = Object.fromEntries(
    Object.entries(questionSelections)
      .map(([key, value]) => [key, Array.from(value)] as const)
      .filter(([, value]) => value.length > 0),
  );
  const selected = Array.from(selectedOptions);
  const hasContent =
    !!responseText.trim() ||
    selected.length > 0 ||
    Object.keys(normalizedAnswers).length > 0 ||
    Object.keys(normalizedSelections).length > 0 ||
    currentStep > 0;

  if (!hasContent) return undefined;

  return {
    questionId,
    currentStep,
    responseText,
    selectedOptions: selected,
    questionAnswers: normalizedAnswers,
    questionSelections: normalizedSelections,
  };
}

function draftImagesToAttachedImages(draft?: JobComposerDraft): ReturnType<typeof useImageAttachment>['images'] {
  return (draft?.images || []).map(draftImageToAttachedImage);
}

export function JobDetailPanel() {
  const selectedJobId = useKanbanStore((s) => s.selectedJobId);
  const job = useKanbanStore((s) => s.jobs.find((j) => j.id === selectedJobId));
  const projectId = job?.projectId;
  const project = useKanbanStore((s) => projectId ? s.projects.find((p) => p.id === projectId) : undefined);
  const selectJob = useKanbanStore((s) => s.selectJob);
  const removeJob = useKanbanStore((s) => s.removeJob);
  const settings = useKanbanStore((s) => s.settings);
  const api = useElectronAPI();
  const [responseText, setResponseText] = useState('');
  const [selectedOptions, setSelectedOptionsState] = useState<Set<string>>(new Set());
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({});
  const [questionSelections, setQuestionSelectionsState] = useState<Record<string, Set<string>>>({});
  const [currentQuestionStep, setCurrentQuestionStepState] = useState(0);
  const [followUpText, setFollowUpText] = useState('');
  const [steerText, setSteerText] = useState('');
  const [planFeedbackText, setPlanFeedbackText] = useState('');
  const [retryText, setRetryText] = useState('');
  const [planAction, setPlanAction] = useState<'accept' | 'edit' | null>(null);
  const [planTab, setPlanTab] = useState<'plan' | 'log'>('plan');
  const [doneTab, setDoneTab] = useState<'summary' | 'diff' | 'log'>('summary');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const draftTimeoutsRef = useRef<Partial<Record<DraftSectionKey, ReturnType<typeof setTimeout>>>>({});

  const questionId = job?.pendingQuestion?.questionId;
  const initialSteerImages = useMemo(() => draftImagesToAttachedImages(job?.jobDetailDrafts?.steer), [job?.id]);
  const initialPlanImages = useMemo(() => draftImagesToAttachedImages(job?.jobDetailDrafts?.planEdit), [job?.id]);
  const initialFollowUpImages = useMemo(() => draftImagesToAttachedImages(job?.jobDetailDrafts?.followUp), [job?.id]);
  const initialRetryImages = useMemo(() => draftImagesToAttachedImages(job?.jobDetailDrafts?.retry), [job?.id]);
  const responseTextRef = useRef(responseText);
  const selectedOptionsRef = useRef(selectedOptions);
  const questionAnswersRef = useRef(questionAnswers);
  const questionSelectionsRef = useRef(questionSelections);
  const currentQuestionStepRef = useRef(currentQuestionStep);
  const questionIdRef = useRef(questionId);
  const followUpTextRef = useRef(followUpText);
  const steerTextRef = useRef(steerText);
  const planFeedbackTextRef = useRef(planFeedbackText);
  const retryTextRef = useRef(retryText);
  const steerImagesRef = useRef(initialSteerImages);
  const planImagesRef = useRef(initialPlanImages);
  const followUpImagesRef = useRef(initialFollowUpImages);
  const retryImagesRef = useRef(initialRetryImages);
  const draftVersionRef = useRef(job?.jobDetailDraftVersion || 0);

  function nextDraftVersion() {
    const next = Math.max(draftVersionRef.current, job?.jobDetailDraftVersion || 0) + 1;
    draftVersionRef.current = next;
    return next;
  }

  function persistDraftSection(jobId: string, section: DraftSectionKey, value: JobDetailDrafts[DraftSectionKey]) {
    const version = nextDraftVersion();
    void api.jobsUpdateDrafts(jobId, { [section]: value } as Partial<JobDetailDrafts>, version).catch((err) => {
      if (err instanceof Error && err.message === 'Job not found') {
        return;
      }
      console.error('[JobDetailPanel] Failed to persist draft', section, err);
    });
  }

  function scheduleDraftSection(jobId: string, section: DraftSectionKey, value: JobDetailDrafts[DraftSectionKey]) {
    const existing = draftTimeoutsRef.current[section];
    if (existing) clearTimeout(existing);
    draftTimeoutsRef.current[section] = setTimeout(() => {
      draftTimeoutsRef.current[section] = undefined;
      persistDraftSection(jobId, section, value);
    }, 250);
  }

  function flushDraftSection(jobId: string, section: DraftSectionKey, value: JobDetailDrafts[DraftSectionKey]) {
    const existing = draftTimeoutsRef.current[section];
    if (existing) {
      clearTimeout(existing);
      draftTimeoutsRef.current[section] = undefined;
    }
    persistDraftSection(jobId, section, value);
  }

  const steerImages = useImageAttachment({
    initialImages: initialSteerImages,
    onChange: (images) => {
      steerImagesRef.current = images;
      if (!job?.id) return;
      persistDraftSection(job.id, 'steer', buildComposerDraft(steerTextRef.current, images));
    },
  });
  const planImages = useImageAttachment({
    initialImages: initialPlanImages,
    onChange: (images) => {
      planImagesRef.current = images;
      if (!job?.id) return;
      persistDraftSection(job.id, 'planEdit', buildComposerDraft(planFeedbackTextRef.current, images));
    },
  });
  const followUpImages = useImageAttachment({
    initialImages: initialFollowUpImages,
    onChange: (images) => {
      followUpImagesRef.current = images;
      if (!job?.id) return;
      persistDraftSection(job.id, 'followUp', buildComposerDraft(followUpTextRef.current, images));
    },
  });
  const retryImages = useImageAttachment({
    initialImages: initialRetryImages,
    onChange: (images) => {
      retryImagesRef.current = images;
      if (!job?.id) return;
      persistDraftSection(job.id, 'retry', buildComposerDraft(retryTextRef.current, images));
    },
  });

  const persistDraftSectionRef = useRef(persistDraftSection);
  persistDraftSectionRef.current = persistDraftSection;
  const selectedJobIdRef = useRef(selectedJobId);
  selectedJobIdRef.current = selectedJobId;

  const setSelectedOptions: React.Dispatch<React.SetStateAction<Set<string>>> = useCallback((value) => {
    setSelectedOptionsState((prev) => {
      const next = typeof value === 'function' ? value(prev) : value;
      const jobId = selectedJobIdRef.current;
      if (jobId) {
        persistDraftSectionRef.current(
          jobId,
          'pendingQuestion',
          buildPendingQuestionDraft(
            questionIdRef.current,
            currentQuestionStepRef.current,
            responseTextRef.current,
            next,
            questionAnswersRef.current,
            questionSelectionsRef.current,
          ),
        );
      }
      return next;
    });
  }, []);

  const setQuestionSelections: React.Dispatch<React.SetStateAction<Record<string, Set<string>>>> = useCallback((value) => {
    setQuestionSelectionsState((prev) => {
      const next = typeof value === 'function' ? value(prev) : value;
      const jobId = selectedJobIdRef.current;
      if (jobId) {
        persistDraftSectionRef.current(
          jobId,
          'pendingQuestion',
          buildPendingQuestionDraft(
            questionIdRef.current,
            currentQuestionStepRef.current,
            responseTextRef.current,
            selectedOptionsRef.current,
            questionAnswersRef.current,
            next,
          ),
        );
      }
      return next;
    });
  }, []);

  const setCurrentQuestionStep: React.Dispatch<React.SetStateAction<number>> = useCallback((value) => {
    setCurrentQuestionStepState((prev) => {
      const next = typeof value === 'function' ? value(prev) : value;
      const jobId = selectedJobIdRef.current;
      if (jobId) {
        persistDraftSectionRef.current(
          jobId,
          'pendingQuestion',
          buildPendingQuestionDraft(
            questionIdRef.current,
            next,
            responseTextRef.current,
            selectedOptionsRef.current,
            questionAnswersRef.current,
            questionSelectionsRef.current,
          ),
        );
      }
      return next;
    });
  }, []);

  // Persisted editedFiles (survives restart) — used in done-state views
  const persistedEditedFiles = useMemo(() => {
    if (job?.editedFiles && job.editedFiles.length > 0) {
      return job.editedFiles.map((p) => ({ path: p, tool: 'Edit' }));
    }
    return null;
  }, [job?.editedFiles]);
  const isActive = job?.status === 'running' || job?.status === 'waiting-input';

  useEffect(() => {
    draftVersionRef.current = job?.jobDetailDraftVersion || 0;
  }, [job?.id, job?.jobDetailDraftVersion]);

  useEffect(() => {
    responseTextRef.current = responseText;
  }, [responseText]);
  useEffect(() => {
    selectedOptionsRef.current = selectedOptions;
  }, [selectedOptions]);
  useEffect(() => {
    questionAnswersRef.current = questionAnswers;
  }, [questionAnswers]);
  useEffect(() => {
    questionSelectionsRef.current = questionSelections;
  }, [questionSelections]);
  useEffect(() => {
    currentQuestionStepRef.current = currentQuestionStep;
  }, [currentQuestionStep]);
  useEffect(() => {
    questionIdRef.current = questionId;
  }, [questionId]);
  useEffect(() => {
    followUpTextRef.current = followUpText;
  }, [followUpText]);
  useEffect(() => {
    steerTextRef.current = steerText;
  }, [steerText]);
  useEffect(() => {
    planFeedbackTextRef.current = planFeedbackText;
  }, [planFeedbackText]);
  useEffect(() => {
    retryTextRef.current = retryText;
  }, [retryText]);

  useEffect(() => {
    const drafts = job?.jobDetailDrafts;
    steerImagesRef.current = initialSteerImages;
    planImagesRef.current = initialPlanImages;
    followUpImagesRef.current = initialFollowUpImages;
    retryImagesRef.current = initialRetryImages;
    setFollowUpText(drafts?.followUp?.text || '');
    setSteerText(drafts?.steer?.text || '');
    setPlanFeedbackText(drafts?.planEdit?.text || '');
    setRetryText(drafts?.retry?.text || '');

    const pendingDraft = drafts?.pendingQuestion;
    if (questionId && pendingDraft?.questionId === questionId) {
      setCurrentQuestionStepState(pendingDraft.currentStep || 0);
      setResponseText(pendingDraft.responseText || '');
      setSelectedOptionsState(new Set(pendingDraft.selectedOptions || []));
      setQuestionAnswers(pendingDraft.questionAnswers || {});
      setQuestionSelectionsState(
        Object.fromEntries(
          Object.entries(pendingDraft.questionSelections || {}).map(([key, value]) => [key, new Set(value)]),
        ),
      );
    } else {
      setCurrentQuestionStepState(0);
      setResponseText('');
      setSelectedOptionsState(new Set());
      setQuestionAnswers({});
      setQuestionSelectionsState({});
    }
  }, [job?.id, questionId, initialSteerImages, initialPlanImages, initialFollowUpImages, initialRetryImages]);

  useEffect(() => {
    if (!job?.id) return;
    scheduleDraftSection(job.id, 'steer', buildComposerDraft(steerText, steerImages.images));
  }, [job?.id, steerText]);

  useEffect(() => {
    if (!job?.id) return;
    scheduleDraftSection(job.id, 'planEdit', buildComposerDraft(planFeedbackText, planImages.images));
  }, [job?.id, planFeedbackText]);

  useEffect(() => {
    if (!job?.id) return;
    scheduleDraftSection(job.id, 'followUp', buildComposerDraft(followUpText, followUpImages.images));
  }, [job?.id, followUpText]);

  useEffect(() => {
    if (!job?.id) return;
    scheduleDraftSection(job.id, 'retry', buildComposerDraft(retryText, retryImages.images));
  }, [job?.id, retryText]);

  useEffect(() => {
    if (!job?.id) return;
    scheduleDraftSection(
      job.id,
      'pendingQuestion',
      buildPendingQuestionDraft(questionId, currentQuestionStep, responseText, selectedOptions, questionAnswers, questionSelections),
    );
  }, [job?.id, questionId, responseText, questionAnswers]);

  useEffect(() => {
    const currentJobId = job?.id;
    return () => {
      if (!currentJobId) return;
      flushDraftSection(currentJobId, 'steer', buildComposerDraft(steerTextRef.current, steerImagesRef.current));
      flushDraftSection(currentJobId, 'planEdit', buildComposerDraft(planFeedbackTextRef.current, planImagesRef.current));
      flushDraftSection(currentJobId, 'followUp', buildComposerDraft(followUpTextRef.current, followUpImagesRef.current));
      flushDraftSection(currentJobId, 'retry', buildComposerDraft(retryTextRef.current, retryImagesRef.current));
      flushDraftSection(
        currentJobId,
        'pendingQuestion',
        buildPendingQuestionDraft(
          questionIdRef.current,
          currentQuestionStepRef.current,
          responseTextRef.current,
          selectedOptionsRef.current,
          questionAnswersRef.current,
          questionSelectionsRef.current,
        ),
      );
    };
  }, [job?.id]);

  const handleRespond = useCallback(async () => {
    const store = useKanbanStore.getState();
    const currentJob = store.jobs.find((j) => j.id === selectedJobIdRef.current);
    const pq = currentJob?.pendingQuestion;
    if (!pq || !selectedJobIdRef.current) return;

    const answers: Record<string, string> = {};

    if (pq.subQuestions && pq.subQuestions.length > 0) {
      const qSel = questionSelectionsRef.current;
      const qAns = questionAnswersRef.current;
      for (const sq of pq.subQuestions) {
        const sel = qSel[sq.question];
        if (sel && sel.size > 0) {
          answers[sq.question] = Array.from(sel).join(', ');
        } else if (qAns[sq.question]?.trim()) {
          answers[sq.question] = qAns[sq.question].trim();
        }
      }
      if (Object.keys(answers).length < pq.subQuestions.length) return;
    } else {
      const isMulti = pq.multiSelect;
      const text = isMulti && selectedOptionsRef.current.size > 0
        ? Array.from(selectedOptionsRef.current).join(', ')
        : responseTextRef.current.trim();
      if (!text) return;
      answers[pq.text] = text;
    }

    await api.jobsRespond(selectedJobIdRef.current, answers);
    setResponseText('');
    setSelectedOptions(new Set());
    setQuestionAnswers({});
    setQuestionSelections({});
    setCurrentQuestionStepState(0);
  }, [api, setSelectedOptions, setQuestionSelections]);

  const handleFollowUp = useCallback(async (images?: JobImage[]) => {
    const text = followUpTextRef.current.trim();
    if (!text || !selectedJobIdRef.current) return;
    const updated = await api.jobsFollowUp(selectedJobIdRef.current, text, images);
    if (updated) {
      useKanbanStore.getState().updateJob(updated);
    }
    setFollowUpText('');
  }, [api]);

  const handleSteer = useCallback(async (images?: JobImage[]) => {
    const text = steerTextRef.current.trim();
    if (!text || !selectedJobIdRef.current) return;
    await api.jobsSteer(selectedJobIdRef.current, text, images);
    setSteerText('');
  }, [api]);

  const handleAcceptPlan = useCallback(async () => {
    if (!selectedJobIdRef.current) return;
    setPlanAction('accept');
    try {
      const updated = await api.jobsAcceptPlan(selectedJobIdRef.current);
      if (updated) {
        useKanbanStore.getState().updateJob(updated);
      }
      setPlanFeedbackText('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to accept plan';
      window.alert(message);
    } finally {
      setPlanAction(null);
    }
  }, [api]);

  const handleEditPlan = useCallback(async (images?: JobImage[]) => {
    const feedback = planFeedbackTextRef.current.trim();
    if (!feedback || !selectedJobIdRef.current) return;
    setPlanAction('edit');
    try {
      const updated = await api.jobsEditPlan(selectedJobIdRef.current, feedback, images);
      if (updated) {
        useKanbanStore.getState().updateJob(updated);
      }
      setPlanFeedbackText('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update plan';
      window.alert(message);
    } finally {
      setPlanAction(null);
    }
  }, [api]);

  const handleRejectJob = useCallback(async (rewindIndex?: number) => {
    if (!selectedJobIdRef.current) return;
    const targetIndex = rewindIndex ?? 0;
    const label = targetIndex === 0
      ? 'original state'
      : `after follow-up #${targetIndex}`;
    const confirmed = window.confirm(
      `Roll back to "${label}"? This will undo all file changes made after that point. This cannot be undone.`
    );
    if (!confirmed) return;
    try {
      await api.jobsRejectJob(selectedJobIdRef.current, targetIndex);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to reject job';
      window.alert(message);
    }
  }, [api]);

  const handleCancel = useCallback(async () => {
    if (!selectedJobIdRef.current) return;
    await api.jobsCancel(selectedJobIdRef.current);
  }, [api]);

  const handleDelete = useCallback(async () => {
    if (!selectedJobIdRef.current) return;
    setDeleteLoading(true);
    try {
      await api.jobsDelete(selectedJobIdRef.current);
      removeJob(selectedJobIdRef.current);
      setConfirmDelete(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete job';
      window.alert(message);
    } finally {
      setDeleteLoading(false);
    }
  }, [api, removeJob]);

  const handleRetry = useCallback(async (images?: JobImage[]) => {
    if (!selectedJobIdRef.current) return;
    const msg = retryTextRef.current.trim();
    const updated = await api.jobsRetry(selectedJobIdRef.current, msg || undefined, images);
    if (updated) {
      useKanbanStore.getState().updateJob(updated);
      setRetryText('');
    }
  }, [api]);

  const handleOpenProject = useCallback(async () => {
    if (!project) return;
    const result = await api.projectsOpenInEditor(project.id, job?.branch);
    if (!result.success) {
      window.alert(result.error || 'Failed to open project in editor.');
    }
  }, [api, project, job?.branch]);

  if (!job) return null;

  const projectColor = getProjectColor(project?.color);

  const hasUncommittedChanges =
    (job.userMessageUuids?.length ?? 0) > 0 && !job.committedSha && job.status !== 'rejected' && (job.editedFiles?.length ?? 0) > 0;

  const isDone = job.status === 'completed' || job.status === 'rejected';
  const isPlanReady = job.status === 'plan-ready';
  const hasSummary = !!job.summaryText && isDone;
  const hasRewindPoints = (job.userMessageUuids?.length ?? 0) > 0;
  const hasStepSnapshots = (job.stepSnapshots?.length ?? 0) > 0;
  const hasDiff = isDone && (hasStepSnapshots || hasRewindPoints || !!job.diffText);
  const canDelete = job.status !== 'running' && job.status !== 'waiting-input';

  return (
    <div className="w-[480px] shrink-0 border-l border-chrome-subtle/70 bg-surface-secondary flex flex-col overflow-hidden">
      {/* Project color accent bar */}
      <div className="h-[3px] shrink-0" style={{ backgroundColor: projectColor }} />

      {/* Header */}
      <div className="shrink-0 border-b border-chrome-subtle/70">
        {/* Top row: project/branch + action icons */}
        <div className="flex items-center justify-between px-4 pt-2.5">
          <div className="flex items-center gap-1.5 text-[10px] text-content-tertiary uppercase tracking-wider min-w-0">
            {project ? (
              <button
                onClick={() => { void handleOpenProject(); }}
                className="group/open flex items-center gap-1.5 hover:text-content-secondary transition-colors rounded -ml-1 px-1 py-0.5"
                title={`Open ${project.isGitRepo ? 'in editor' : 'folder'}${job.branch ? ` on ${job.branch}` : ''}`}
              >
                <span
                  className="inline-block w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: projectColor }}
                />
                <span>{project.name}</span>
              </button>
            ) : (
              <span>Unknown</span>
            )}
            {job.branch && (
              <span className="flex items-center gap-1 normal-case tracking-normal text-[11px] font-medium text-content-secondary bg-surface-tertiary/60 rounded px-1.5 py-0.5 max-w-[180px]">
                <BranchIcon size={12} className="shrink-0" />
                <span className="truncate">{job.branch}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {/* Prompt history */}
            <button
              onClick={() => useKanbanStore.getState().setPromptHistoryJobId(job.id)}
              className="p-1.5 text-content-tertiary hover:text-content-secondary transition-colors rounded"
              aria-label="View prompt history"
              title="View prompt history"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 4h12M2 8h8M2 12h10" />
              </svg>
            </button>

            {/* Roll Back */}
            {canDelete && hasUncommittedChanges && (
              <button
                onClick={() => handleRejectJob(0)}
                className="p-1.5 text-content-tertiary hover:text-semantic-warning transition-colors rounded"
                aria-label="Roll back changes"
                title="Roll back all changes"
              >
                <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M2 6h5M4.5 3.5L2 6l2.5 2.5M10 3v6" />
                </svg>
              </button>
            )}

            {/* Delete */}
            {canDelete && (
              <div className="relative">
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="p-1.5 text-content-tertiary hover:text-semantic-error transition-colors rounded"
                  aria-label="Delete job"
                  title="Delete job"
                >
                  <TrashIcon size={14} />
                </button>

                {/* Delete confirmation popover */}
                {confirmDelete && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => !deleteLoading && setConfirmDelete(false)} />
                    <div className="absolute right-0 top-full mt-1 z-50 bg-surface-elevated border border-chrome rounded-lg shadow-lg p-3 w-[200px]">
                      <p className="text-xs text-content-secondary mb-2">
                        Delete this job permanently?
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setConfirmDelete(false)}
                          disabled={deleteLoading}
                          className="flex-1 px-2 py-1.5 text-xs rounded border border-chrome text-content-secondary hover:bg-surface-tertiary disabled:opacity-50 transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleDelete()}
                          disabled={deleteLoading}
                          className="flex-1 px-2 py-1.5 text-xs rounded bg-semantic-error text-white hover:bg-semantic-error/80 disabled:opacity-50 transition-colors"
                        >
                          {deleteLoading ? 'Deleting...' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Close */}
            <button
              onClick={() => selectJob(null)}
              className="p-1.5 text-content-tertiary hover:text-content-secondary transition-colors rounded"
              aria-label="Close panel"
            >
              <XIcon size={14} />
            </button>
          </div>
        </div>

        {/* Timeline + durations — full width */}
        <div className="px-4 pb-2.5">
          <PromptTimeline
            prompt={job.prompt}
            jobTitle={job.title}
            followUps={job.followUps}
            rewindPoints={job.status === 'completed' ? job.userMessageUuids : undefined}
            onRollback={job.status === 'completed' ? handleRejectJob : undefined}
            isActive={isActive}
          />
        </div>
      </div>

      {/* Done-state tabbed view (summary / diff / steps / log) */}
      {isDone && (hasSummary || hasDiff) && (
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Tab bar */}
          <div className="flex items-center gap-0 px-3 pt-1.5 border-b border-chrome-subtle/40">
            {hasSummary && (
              <TabButton active={doneTab === 'summary'} onClick={() => setDoneTab('summary')}>
                Summary
              </TabButton>
            )}
            {hasDiff && (
              <TabButton active={doneTab === 'diff'} onClick={() => setDoneTab('diff')}>
                Diff
              </TabButton>
            )}
            <TabButton active={doneTab === 'log'} onClick={() => setDoneTab('log')}>
              Log
            </TabButton>
            {doneTab === 'summary' && hasSummary && (
              <CopyButton text={job.summaryText!} className="ml-auto" />
            )}
          </div>

          {/* Tab content */}
          {doneTab === 'summary' && hasSummary && (
            <div className="flex-1 min-h-0 overflow-y-auto p-3">
              <PlanView content={job.summaryText!} />
              {persistedEditedFiles
                ? <EditedFilesList files={persistedEditedFiles} projectId={job.projectId} />
                : <LiveEditedFilesContainer jobId={job.id} projectId={job.projectId} />
              }
            </div>
          )}
          {doneTab === 'diff' && hasDiff && (
            <div className="flex-1 min-h-0 overflow-y-auto p-3">
              <DiffViewer jobId={job.id} />
            </div>
          )}
          {doneTab === 'log' && (
            <div className="flex-1 min-h-0 p-3 flex flex-col">
              <StreamingLogContainer jobId={job.id} />
            </div>
          )}
        </div>
      )}

      {/* Done state without summary or diff — show edited files + log */}
      {isDone && !hasSummary && !hasDiff && (
        <div className="flex-1 min-h-0 p-3 flex flex-col">
          <StreamingLogContainer jobId={job.id} />
          {persistedEditedFiles
            ? <EditedFilesList files={persistedEditedFiles} projectId={job.projectId} />
            : <LiveEditedFilesContainer jobId={job.id} projectId={job.projectId} />
          }
        </div>
      )}

      {/* Plan-ready tabbed view (plan / log) */}
      {isPlanReady && (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center gap-0 px-3 pt-1.5 border-b border-chrome-subtle/40">
            <TabButton active={planTab === 'plan'} onClick={() => setPlanTab('plan')}>
              Plan
            </TabButton>
            <TabButton active={planTab === 'log'} onClick={() => setPlanTab('log')}>
              Log
            </TabButton>
            {planTab === 'plan' && job.planText && (
              <CopyButton text={job.planText} className="ml-auto" />
            )}
          </div>

          {planTab === 'plan' && (
            <div className="flex-1 min-h-0 overflow-y-auto p-3">
              {job.planText ? (
                <PlanView content={job.planText} />
              ) : (
                <div className="text-sm text-content-tertiary italic">
                  No plan text was captured. Request changes to regenerate it.
                </div>
              )}
            </div>
          )}
          {planTab === 'log' && (
            <div className="flex-1 min-h-0 p-3 flex flex-col">
              <StreamingLogContainer jobId={job.id} />
            </div>
          )}
        </div>
      )}

      {!isDone && !isPlanReady && (
        <div className="flex-1 min-h-0 p-3 flex flex-col">
          <StreamingLogContainer jobId={job.id} />
        </div>
      )}

      {/* Context window fill — session-level stat above input */}
      <ContextUsageBar job={job} settings={settings} />

      {/* Action area */}
      <ActionArea
        job={job}
        responseText={responseText}
        setResponseText={setResponseText}
        selectedOptions={selectedOptions}
        setSelectedOptions={setSelectedOptions}
        questionAnswers={questionAnswers}
        setQuestionAnswers={setQuestionAnswers}
        questionSelections={questionSelections}
        setQuestionSelections={setQuestionSelections}
        currentQuestionStep={currentQuestionStep}
        setCurrentQuestionStep={setCurrentQuestionStep}
        followUpText={followUpText}
        setFollowUpText={setFollowUpText}
        steerText={steerText}
        setSteerText={setSteerText}
        planFeedbackText={planFeedbackText}
        setPlanFeedbackText={setPlanFeedbackText}
        retryText={retryText}
        setRetryText={setRetryText}
        steerImages={steerImages}
        planImages={planImages}
        followUpImages={followUpImages}
        retryImages={retryImages}
        planAction={planAction}
        onRespond={handleRespond}
        onFollowUp={handleFollowUp}
        onSteer={handleSteer}
        onAcceptPlan={handleAcceptPlan}
        onEditPlan={handleEditPlan}
        onRetry={handleRetry}
        onCancel={handleCancel}
      />

      {/* Phase durations — bottom footer */}
      <DetailPhaseDurations job={job} settings={settings} />
    </div>
  );
}

/* ─── Action Area ─── */

interface ActionAreaProps {
  job: Job;
  responseText: string;
  setResponseText: (v: string) => void;
  selectedOptions: Set<string>;
  setSelectedOptions: React.Dispatch<React.SetStateAction<Set<string>>>;
  questionAnswers: Record<string, string>;
  setQuestionAnswers: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  questionSelections: Record<string, Set<string>>;
  setQuestionSelections: React.Dispatch<React.SetStateAction<Record<string, Set<string>>>>;
  currentQuestionStep: number;
  setCurrentQuestionStep: React.Dispatch<React.SetStateAction<number>>;
  followUpText: string;
  setFollowUpText: (v: string) => void;
  steerText: string;
  setSteerText: (v: string) => void;
  planFeedbackText: string;
  setPlanFeedbackText: (v: string) => void;
  retryText: string;
  setRetryText: (v: string) => void;
  steerImages: ReturnType<typeof useImageAttachment>;
  planImages: ReturnType<typeof useImageAttachment>;
  followUpImages: ReturnType<typeof useImageAttachment>;
  retryImages: ReturnType<typeof useImageAttachment>;
  planAction: 'accept' | 'edit' | null;
  onRespond: () => void;
  onFollowUp: (images?: JobImage[]) => void;
  onSteer: (images?: JobImage[]) => void;
  onAcceptPlan: () => void;
  onEditPlan: (images?: JobImage[]) => void;
  onRetry: (images?: JobImage[]) => void;
  onCancel: () => void;
}

const ActionArea = memo(function ActionArea({
  job, responseText, setResponseText, selectedOptions, setSelectedOptions,
  questionAnswers, setQuestionAnswers, questionSelections, setQuestionSelections,
  currentQuestionStep, setCurrentQuestionStep,
  followUpText, setFollowUpText, steerText, setSteerText,
  planFeedbackText, setPlanFeedbackText, retryText, setRetryText, planAction,
  steerImages, planImages, followUpImages, retryImages,
  onRespond, onFollowUp, onSteer, onAcceptPlan, onEditPlan, onRetry, onCancel,
}: ActionAreaProps) {
  const submitSteer = () => { onSteer(steerImages.toJobImages()); steerImages.clearImages(); };
  const submitPlanEdit = () => { onEditPlan(planImages.toJobImages()); planImages.clearImages(); };
  const submitFollowUp = () => { onFollowUp(followUpImages.toJobImages()); followUpImages.clearImages(); };
  const submitRetry = () => { onRetry(retryImages.toJobImages()); retryImages.clearImages(); };

  const planRef = useRef<HTMLDivElement>(null);
  const planSubmit = planFeedbackText.trim() ? submitPlanEdit : onAcceptPlan;
  useShortcut('submitForm', planSubmit, {
    ref: planRef,
    enabled: job.status === 'plan-ready' && planAction === null,
  });

  const followUpRef = useRef<HTMLDivElement>(null);
  useShortcut('submitForm', submitFollowUp, {
    ref: followUpRef,
    enabled: job.status === 'completed' && !!followUpText.trim(),
  });

  const retryRef = useRef<HTMLDivElement>(null);
  useShortcut('submitForm', submitRetry, {
    ref: retryRef,
    enabled: job.status === 'error',
  });

  if (job.status === 'rejected') {
    return (
      <div className="shrink-0 px-3 py-2 border-t border-chrome-subtle/70">
        <div className="text-xs text-semantic-error bg-semantic-error-bg/20 rounded-md px-3 py-2 text-center">
          Changes rolled back
        </div>
      </div>
    );
  }

  // Running jobs — steer input
  if (job.status === 'running') {
    return (
      <div className="shrink-0 px-3 py-2.5 border-t border-chrome-subtle/70">
        <div className="space-y-2">
          <MentionTextarea
            value={steerText}
            onChange={setSteerText}
            onPaste={steerImages.handlePaste}
            onDrop={steerImages.handleDrop}
            onDragOver={steerImages.handleDragOver}
            projectId={job.projectId}
            placeholder="Steer: redirect the current task..."
            rows={3}
            className="w-full resize-none rounded-lg border border-chrome bg-surface-elevated px-3 py-2 text-sm text-content-primary placeholder:text-content-tertiary focus:outline-none focus:ring-2 focus:ring-focus-ring/40"
          />
          <div className="flex items-center gap-2">
            <ImageAttachmentBar images={steerImages.images} onRemove={steerImages.removeImage} onAddFiles={steerImages.addFiles} compact />
            <button
              onClick={onCancel}
              className="ml-auto shrink-0 flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-semantic-error/30 text-semantic-error hover:bg-semantic-error-bg/10 transition-colors"
              aria-label="Stop job"
              title="Stop job"
            >
              <StopIcon size={14} />
              Stop
            </button>
            <button
              onClick={submitSteer}
              disabled={!steerText.trim()}
              className="shrink-0 flex items-center justify-center gap-1.5 px-4 py-1.5 text-sm rounded-lg bg-btn-primary text-content-inverted hover:bg-btn-primary-hover disabled:opacity-40 transition-colors"
            >
              Steer
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 px-3 py-2.5 border-t border-chrome-subtle/70 space-y-2">
      {job.status === 'plan-ready' && (
        <div ref={planRef} className="space-y-2">
          <MentionTextarea
            value={planFeedbackText}
            onChange={setPlanFeedbackText}
            onPaste={planImages.handlePaste}
            onDrop={planImages.handleDrop}
            onDragOver={planImages.handleDragOver}
            projectId={job.projectId}
            placeholder="Revision notes — scope, ordering, risks, missing work..."
            rows={3}
            className="w-full resize-none rounded-lg border border-chrome bg-surface-elevated px-3 py-2 text-sm text-content-primary placeholder:text-content-tertiary focus:outline-none focus:ring-2 focus:ring-focus-ring/40"
          />
          <div className="flex items-center gap-2">
            <ImageAttachmentBar images={planImages.images} onRemove={planImages.removeImage} onAddFiles={planImages.addFiles} compact />
            <button
              onClick={planFeedbackText.trim() ? submitPlanEdit : onAcceptPlan}
              disabled={planAction !== null}
              className="ml-auto shrink-0 flex items-center justify-center gap-1.5 px-4 py-1.5 text-sm rounded-lg bg-btn-primary text-content-inverted hover:bg-btn-primary-hover disabled:opacity-40 transition-colors"
            >
              {planAction && <Spinner className="text-content-inverted" />}
              {planAction === 'edit' ? 'Revising...' : planAction === 'accept' ? 'Starting...' : planFeedbackText.trim() ? 'Request Edit' : 'Start Development'}
              <Kbd shortcutId="submitForm" />
            </button>
          </div>
        </div>
      )}

      {/* Pending question */}
      {job.status === 'waiting-input' && job.pendingQuestion && (() => {
        const pq = job.pendingQuestion;
        const hasSubQuestions = pq.subQuestions && pq.subQuestions.length > 0;

        // Multi-question mode — sequential, one at a time
        if (hasSubQuestions) {
          const subQs = pq.subQuestions!;
          const total = subQs.length;
          const step = Math.min(currentQuestionStep, total - 1);
          const currentSq = subQs[step];
          const isLastStep = step === total - 1;

          const isCurrentAnswered = (() => {
            const sel = questionSelections[currentSq.question];
            return (sel && sel.size > 0) || !!questionAnswers[currentSq.question]?.trim();
          })();

          const getAnswerSummary = (sq: SubQuestion) => {
            const sel = questionSelections[sq.question];
            if (sel && sel.size > 0) return Array.from(sel).join(', ');
            if (questionAnswers[sq.question]?.trim()) return questionAnswers[sq.question].trim();
            return '';
          };

          return (
            <div className="space-y-3">
              {/* Previously answered questions — compact summary */}
              {step > 0 && (
                <div className="space-y-1">
                  {subQs.slice(0, step).map((sq, qi) => (
                    <button
                      key={qi}
                      onClick={() => setCurrentQuestionStep(qi)}
                      className="w-full text-left px-2.5 py-1.5 rounded border border-chrome hover:bg-surface-tertiary transition-colors group"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          {sq.header && (
                            <span className="text-[10px] font-semibold text-content-tertiary uppercase tracking-wider mr-2">
                              {sq.header}
                            </span>
                          )}
                          <span className="text-xs text-content-secondary truncate">
                            {getAnswerSummary(sq)}
                          </span>
                        </div>
                        <span className="text-[10px] text-content-tertiary opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          Edit
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Step indicator */}
              <div className="flex items-center justify-between">
                <div className="text-[10px] text-content-tertiary font-medium">
                  {step + 1} / {total}
                </div>
                {/* Step dots */}
                <div className="flex gap-1">
                  {subQs.map((_, i) => (
                    <div
                      key={i}
                      className={`w-1.5 h-1.5 rounded-full transition-colors ${i === step
                          ? 'bg-focus-ring'
                          : i < step
                            ? 'bg-content-tertiary'
                            : 'bg-chrome'
                        }`}
                    />
                  ))}
                </div>
              </div>

              {/* Current question */}
              <SubQuestionSection
                sq={currentSq}
                index={step}
                answer={questionAnswers[currentSq.question] || ''}
                selections={questionSelections[currentSq.question] || new Set()}
                onAnswerChange={(val) => setQuestionAnswers((prev) => ({ ...prev, [currentSq.question]: val }))}
                onToggleSelection={(label) => setQuestionSelections((prev) => {
                  const current = prev[currentSq.question] || new Set();
                  const next = new Set(current);
                  if (next.has(label)) next.delete(label);
                  else next.add(label);
                  return { ...prev, [currentSq.question]: next };
                })}
                onSelectSingle={(label) => setQuestionAnswers((prev) => ({ ...prev, [currentSq.question]: label }))}
                projectId={job.projectId}
              />

              {/* Navigation buttons */}
              <div className="flex gap-2">
                {step > 0 && (
                  <button
                    onClick={() => setCurrentQuestionStep((s) => s - 1)}
                    className="px-4 py-1.5 text-sm rounded-lg border border-chrome text-content-secondary hover:bg-surface-tertiary transition-colors"
                  >
                    Back
                  </button>
                )}
                <button
                  onClick={onCancel}
                  className="ml-auto shrink-0 flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-semantic-error/30 text-semantic-error hover:bg-semantic-error-bg/10 transition-colors"
                  aria-label="Stop job"
                  title="Stop job"
                >
                  <StopIcon size={14} />
                  Stop
                </button>
                {isLastStep ? (
                  <button
                    onClick={onRespond}
                    disabled={!isCurrentAnswered}
                    className="px-4 py-1.5 text-sm rounded-lg bg-btn-primary text-content-inverted hover:bg-btn-primary-hover disabled:opacity-40 transition-colors"
                  >
                    Send
                  </button>
                ) : (
                  <button
                    onClick={() => setCurrentQuestionStep((s) => s + 1)}
                    disabled={!isCurrentAnswered}
                    className="px-4 py-1.5 text-sm rounded-lg bg-btn-primary text-content-inverted hover:bg-btn-primary-hover disabled:opacity-40 transition-colors"
                  >
                    Next
                  </button>
                )}
              </div>
            </div>
          );
        }

        // Single-question mode (backward compat)
        return (
          <div className="space-y-2">
            {pq.header && (
              <div className="text-[10px] font-semibold text-content-tertiary uppercase tracking-wider">
                {pq.header}
              </div>
            )}
            <div className="text-sm font-medium text-semantic-warning">
              {pq.text}
            </div>
            {pq.options && (
              <div className="flex flex-col gap-1">
                {pq.options.map((opt, i) => {
                  const isMulti = pq.multiSelect;
                  const isSelected = isMulti
                    ? selectedOptions.has(opt.label)
                    : responseText === opt.label;

                  return (
                    <button
                      key={i}
                      onClick={() => {
                        if (isMulti) {
                          setSelectedOptions((prev) => {
                            const next = new Set(prev);
                            if (next.has(opt.label)) next.delete(opt.label);
                            else next.add(opt.label);
                            return next;
                          });
                        } else {
                          setResponseText(opt.label);
                        }
                      }}
                      className={`text-left px-2.5 py-1.5 rounded border transition-colors ${isSelected
                          ? 'border-focus-ring bg-focus-ring/10'
                          : 'border-chrome hover:bg-surface-tertiary'
                        }`}
                    >
                      <div className="flex items-center gap-2">
                        {isMulti && (
                          <div className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 ${isSelected ? 'border-focus-ring bg-focus-ring' : 'border-content-tertiary'
                            }`}>
                            {isSelected && (
                              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M2 5l2.5 2.5L8 3" />
                              </svg>
                            )}
                          </div>
                        )}
                        <div>
                          <div className="text-xs font-medium text-content-primary">{opt.label}</div>
                          {opt.description && (
                            <div className="text-[10px] text-content-tertiary mt-0.5">{opt.description}</div>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex gap-2">
              <MentionInput
                value={pq.multiSelect && selectedOptions.size > 0
                  ? Array.from(selectedOptions).join(', ')
                  : responseText}
                onChange={(v) => {
                  if (!pq.multiSelect) {
                    setResponseText(v);
                  }
                }}
                onKeyDown={(e) => e.key === 'Enter' && onRespond()}
                projectId={job.projectId}
                placeholder={pq.multiSelect ? 'Select options above...' : 'Type your response...'}
                readOnly={!!pq.multiSelect && selectedOptions.size > 0}
                className="w-full px-3 py-1.5 text-sm rounded-lg border border-chrome bg-surface-elevated focus:outline-none focus:ring-2 focus:ring-focus-ring/40"
              />
              <button
                onClick={onCancel}
                className="shrink-0 flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-semantic-error/30 text-semantic-error hover:bg-semantic-error-bg/10 transition-colors"
                aria-label="Stop job"
                title="Stop job"
              >
                <StopIcon size={14} />
                Stop
              </button>
              <button
                onClick={onRespond}
                disabled={pq.multiSelect
                  ? selectedOptions.size === 0
                  : !responseText.trim()}
                className="px-4 py-1.5 text-sm rounded-lg bg-btn-primary text-content-inverted hover:bg-btn-primary-hover disabled:opacity-40 transition-colors"
              >
                Send
              </button>
            </div>
          </div>
        );
      })()}

      {/* Completed — follow-up input */}
      {job.status === 'completed' && (
        <div ref={followUpRef} className="space-y-2">
          <MentionTextarea
            value={followUpText}
            onChange={setFollowUpText}
            onPaste={followUpImages.handlePaste}
            onDrop={followUpImages.handleDrop}
            onDragOver={followUpImages.handleDragOver}
            projectId={job.projectId}
            placeholder="Follow up: e.g. 'also add tests'..."
            rows={3}
            className="w-full resize-none rounded-lg border border-chrome bg-surface-elevated px-3 py-2 text-sm text-content-primary placeholder:text-content-tertiary focus:outline-none focus:ring-2 focus:ring-focus-ring/40"
          />
          <div className="flex items-center gap-2">
            <ImageAttachmentBar images={followUpImages.images} onRemove={followUpImages.removeImage} onAddFiles={followUpImages.addFiles} compact />
            <button
              onClick={submitFollowUp}
              disabled={!followUpText.trim()}
              className="ml-auto shrink-0 flex items-center justify-center gap-1.5 px-4 py-1.5 text-sm rounded-lg bg-btn-primary text-content-inverted hover:bg-btn-primary-hover disabled:opacity-40 transition-colors"
            >
              Follow Up<Kbd shortcutId="submitForm" />
            </button>
          </div>
        </div>
      )}

      {/* Error / stopped state */}
      {job.status === 'error' && (() => {
        const isCancelled = job.error === 'Cancelled by user';
        return (
          <div ref={retryRef} className="space-y-2">
            <div className="text-xs text-semantic-error bg-semantic-error-bg/20 rounded-md px-3 py-2">
              {job.error || 'An error occurred'}
            </div>
            <MentionTextarea
              value={retryText}
              onChange={setRetryText}
              onPaste={retryImages.handlePaste}
              onDrop={retryImages.handleDrop}
              onDragOver={retryImages.handleDragOver}
              projectId={job.projectId}
              placeholder={isCancelled
                ? "Add a message or leave empty to resume..."
                : "Add a message or leave empty to retry..."
              }
              rows={2}
              className="w-full resize-none rounded-lg border border-chrome bg-surface-elevated px-3 py-2 text-sm text-content-primary placeholder:text-content-tertiary focus:outline-none focus:ring-2 focus:ring-focus-ring/40"
            />
            <div className="flex items-center gap-2">
              <ImageAttachmentBar images={retryImages.images} onRemove={retryImages.removeImage} onAddFiles={retryImages.addFiles} compact />
              <button
                onClick={submitRetry}
                className="ml-auto shrink-0 flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-btn-primary text-content-inverted text-sm font-medium hover:bg-btn-primary-hover transition-colors"
              >
                {retryText.trim() ? 'Send' : isCancelled ? 'Resume' : 'Retry'}<Kbd shortcutId="submitForm" />
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
});

/* ─── Sub Question Section ─── */

function SubQuestionSection({
  sq, index, answer, selections, onAnswerChange, onToggleSelection, onSelectSingle, projectId,
}: {
  sq: SubQuestion;
  index: number;
  answer: string;
  selections: Set<string>;
  onAnswerChange: (val: string) => void;
  onToggleSelection: (label: string) => void;
  onSelectSingle: (label: string) => void;
  projectId: string;
}) {
  return (
    <div className="space-y-1.5">
      {sq.header && (
        <div className="text-[10px] font-semibold text-content-tertiary uppercase tracking-wider">
          {sq.header}
        </div>
      )}
      <div className="text-sm font-medium text-semantic-warning">
        {sq.question}
      </div>
      {sq.options && sq.options.length > 0 ? (
        <div className="space-y-2">
          <div className="flex flex-col gap-1">
            {sq.options.map((opt, i) => {
              const isSelected = sq.multiSelect
                ? selections.has(opt.label)
                : answer === opt.label;

              return (
                <button
                  key={i}
                  onClick={() => {
                    if (sq.multiSelect) {
                      onToggleSelection(opt.label);
                    } else {
                      onSelectSingle(opt.label);
                    }
                  }}
                  className={`text-left px-2.5 py-1.5 rounded border transition-colors ${isSelected
                      ? 'border-focus-ring bg-focus-ring/10'
                      : 'border-chrome hover:bg-surface-tertiary'
                    }`}
                >
                  <div className="flex items-center gap-2">
                    {sq.multiSelect && (
                      <div className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 ${isSelected ? 'border-focus-ring bg-focus-ring' : 'border-content-tertiary'
                        }`}>
                        {isSelected && (
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2 5l2.5 2.5L8 3" />
                          </svg>
                        )}
                      </div>
                    )}
                    <div>
                      <div className="text-xs font-medium text-content-primary">{opt.label}</div>
                      {opt.description && (
                        <div className="text-[10px] text-content-tertiary mt-0.5">{opt.description}</div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          {/* Custom response — allows typing instead of selecting an option */}
          <MentionInput
            value={sq.multiSelect ? '' : (sq.options!.some((o) => o.label === answer) ? '' : answer)}
            onChange={(v) => {
              if (!sq.multiSelect) {
                onAnswerChange(v);
              }
            }}
            projectId={projectId}
            placeholder="Or type a custom response..."
            className="w-full px-3 py-1.5 text-xs rounded-lg border border-chrome bg-surface-elevated focus:outline-none focus:ring-2 focus:ring-focus-ring/40 text-content-tertiary placeholder:text-content-tertiary"
          />
        </div>
      ) : (
        <MentionInput
          value={answer}
          onChange={onAnswerChange}
          projectId={projectId}
          placeholder="Type your response..."
          className="w-full px-3 py-1.5 text-sm rounded-lg border border-chrome bg-surface-elevated focus:outline-none focus:ring-2 focus:ring-focus-ring/40"
        />
      )}
    </div>
  );
}

/* ─── Tab Button ─── */

const TabButton = memo(function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider border-b-2 transition-colors ${active
          ? 'border-content-primary text-content-primary'
          : 'border-transparent text-content-tertiary hover:text-content-secondary'
        }`}
    >
      {children}
    </button>
  );
});

/* ─── Token Formatting ─── */

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/* ─── Context Usage Bar ─── */

const ContextUsageBar = memo(function ContextUsageBar({ job, settings }: { job: Job; settings: AppSettings }) {
  const ctx = job.contextUsage;
  if (!ctx || !settings.showContextUsage) return null;

  const pct = Math.min((ctx.used / ctx.limit) * 100, 100);
  // Threshold colors: calm below 60%, warm 60-85%, hot above 85%
  const barColor = pct >= 85
    ? 'bg-semantic-warning'
    : pct >= 60
      ? 'bg-content-tertiary'
      : 'bg-content-tertiary/50';

  return (
    <div className="shrink-0 px-3 py-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-medium text-content-tertiary uppercase tracking-wider shrink-0">ctx</span>
        <div className="flex-1 h-1 rounded-full bg-chrome-subtle/60 overflow-hidden">
          <div
            className={`h-full rounded-full ${barColor} transition-all duration-500 ease-out`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span
          className="text-[9px] font-mono text-content-tertiary tabular-nums shrink-0"
          title={`Context: ${ctx.used.toLocaleString()} / ${ctx.limit.toLocaleString()} tokens (${pct.toFixed(0)}%)`}
        >
          {formatTokenCount(ctx.used)}<span className="opacity-40"> / </span>{formatTokenCount(ctx.limit)}
        </span>
      </div>
    </div>
  );
});

/* ─── Phase Durations ─── */

const DetailPhaseDurations = memo(function DetailPhaseDurations({ job, settings }: { job: Job; settings: AppSettings }) {
  const isActive = job.status === 'running' || job.status === 'waiting-input';
  const now = useNow(isActive ? 1000 : 0);

  let pausedMs = job.totalPausedMs || 0;
  if ((job.status === 'waiting-input' || job.status === 'plan-ready') && job.waitingStartedAt) {
    pausedMs += now - new Date(job.waitingStartedAt).getTime();
  }

  const phases: { label: string; value: string; accentColor: string; dotColor: string; active: boolean; tokens?: PhaseTokenUsage }[] = [];
  const errorEnd = job.erroredAt ? new Date(job.erroredAt).getTime() : null;

  if (job.planningStartedAt) {
    const isLive = job.column === 'planning' && !job.planningEndedAt && job.status !== 'plan-ready' && job.status !== 'error';
    const end = job.planningEndedAt
      ? new Date(job.planningEndedAt).getTime()
      : (job.status === 'error' && job.column === 'planning' ? errorEnd : (job.column === 'planning' ? now : null));
    const phasePaused = job.column === 'planning' ? pausedMs : (job.totalPausedMs || 0);
    if (end) {
      phases.push({
        label: 'PLN',
        value: formatDuration(new Date(job.planningStartedAt).getTime() - (job.planningElapsedMs || 0), end, phasePaused),
        accentColor: 'border-l-column-planning',
        dotColor: 'bg-column-planning',
        active: isLive,
        tokens: settings.showTokenUsage ? job.planningTokens : undefined,
      });
    }
  }

  if (job.developmentStartedAt) {
    const isLive = job.column === 'development' && !job.completedAt && job.status !== 'error';
    const end = job.completedAt
      ? new Date(job.completedAt).getTime()
      : (job.status === 'error' && job.column === 'development' ? errorEnd : (job.column === 'development' ? now : null));
    // Subtract planning pauses so only dev pauses count
    const devPaused = job.column === 'development'
      ? Math.max(0, pausedMs - (job.planningPausedMs || 0))
      : Math.max(0, (job.totalPausedMs || 0) - (job.planningPausedMs || 0));
    if (end) {
      phases.push({
        label: 'DEV',
        value: formatDuration(new Date(job.developmentStartedAt).getTime() - (job.developmentElapsedMs || 0), end, devPaused),
        accentColor: 'border-l-column-development',
        dotColor: 'bg-column-development',
        active: isLive,
        tokens: settings.showTokenUsage ? job.developmentTokens : undefined,
      });
    }
  }

  // Model/thinking badges
  const effectiveModel = job.model || settings.defaultModel;
  const effectiveThinkingMode = job.thinkingMode || settings.defaultThinkingMode;
  const availableModels = useKanbanStore((s) => s.availableModels);
  const modelEntry = availableModels.find((o) => o.value === effectiveModel);
  const defaultModelEntry = availableModels.find((o) => o.value === settings.defaultModel);
  const effectiveEffort = normalizeEffortForThinking(
    modelEntry,
    effectiveThinkingMode,
    job.effort || settings.defaultEffort,
  );
  const defaultEffort = normalizeEffortForThinking(
    defaultModelEntry,
    settings.defaultThinkingMode,
    settings.defaultEffort,
  );
  const showBadges = settings.alwaysShowModelEffort
    || effectiveModel !== settings.defaultModel
    || effectiveThinkingMode !== settings.defaultThinkingMode
    || effectiveEffort !== defaultEffort;
  const modelLabel = modelEntry?.label || (settings.alwaysShowModelEffort ? defaultModelEntry?.label || '' : '');
  const thinkingDisplay = getThinkingDisplay(modelEntry, effectiveThinkingMode, effectiveEffort);
  const resolvedThinkingMode = effectiveThinkingMode ?? 'sdkDefault';
  const showThinking = resolvedThinkingMode !== 'disabled';

  if (phases.length === 0 && !showBadges) return null;

  return (
    <div className="shrink-0 px-4 py-1.5 border-t border-chrome-subtle/40 bg-surface-secondary space-y-1">
      {showBadges && (modelLabel || showThinking) && (
        <div className="flex items-center gap-2.5 min-w-0">
          {modelLabel && (
            <span className="text-[10px] font-medium text-content-tertiary uppercase tracking-wider truncate" title={`Model: ${modelLabel}`}>
              {modelLabel}
            </span>
          )}
          {showThinking && thinkingDisplay.effortLabel && (
            <span
              className="flex items-center gap-1.5 text-content-tertiary min-w-0"
              title={`Thinking: ${thinkingDisplay.modeLabel}${thinkingDisplay.effortLabel ? ` · ${thinkingDisplay.effortLabel}` : ''}`}
            >
              <BrainIcon size={11} className="shrink-0 opacity-60" />
              <span className="text-[10px] font-medium uppercase tracking-wider truncate">
                {thinkingDisplay.effortLabel}
              </span>
            </span>
          )}
        </div>
      )}
      {phases.length > 0 && (
        <div className="flex items-center gap-3">
          {phases.map((p) => (
            <div key={p.label} className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.dotColor}`} />
              <span className="text-[10px] font-medium text-content-tertiary uppercase tracking-wider">
                {p.label}
              </span>
              <span className="text-[11px] font-mono text-content-secondary tabular-nums">
                {p.value}
              </span>
              {p.tokens && (
                <span className="text-[10px] font-mono text-content-tertiary tabular-nums">
                  · {formatTokenCount(p.tokens.inputTokens)}↓ {formatTokenCount(p.tokens.outputTokens)}↑
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

/* ─── Plan View ─── */

function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`h-3.5 w-3.5 animate-spin ${className}`} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const PlanView = memo(function PlanView({ content }: { content: string }) {
  return <PlanMarkdown content={content} />;
});

/* ─── Prompt Timeline ─── */

const PromptTimeline = memo(function PromptTimeline({
  prompt,
  jobTitle,
  followUps,
  rewindPoints,
  onRollback,
  isActive,
}: {
  prompt: string;
  jobTitle?: string;
  followUps?: FollowUp[];
  rewindPoints?: string[];
  onRollback?: (index: number) => void;
  isActive?: boolean;
}) {
  const hasFollowUps = followUps && followUps.length > 0;
  const canRollback = rewindPoints && rewindPoints.length > 0 && onRollback;

  // Simple case: no follow-ups and no rollback
  if (!hasFollowUps && !canRollback) {
    return (
      <div className="mt-1">
        <div className="text-sm font-semibold text-content-primary leading-snug">{jobTitle || prompt}</div>
      </div>
    );
  }

  return (
    <div className="mt-1">
      {/* Original title — prominent */}
      <div className="text-sm font-semibold text-content-primary leading-snug">{jobTitle || prompt}</div>

      {/* Follow-ups */}
      {hasFollowUps && (
        <div className="mt-1.5 pt-1.5 border-t border-chrome-subtle/30 space-y-1">
          {followUps!.map((f, i) => {
            const isLast = i === followUps!.length - 1;
            const isCurrent = isLast && isActive;
            const isRolledBack = !!f.rolledBack;
            // Rewind point index is i+1 because index 0 is the original task
            const hasRewindPoint = canRollback && i + 1 < rewindPoints.length;

            return (
              <div key={i} className={`flex items-center gap-1.5 group/step ${isRolledBack ? 'opacity-50' : ''}`}>
                {isCurrent ? (
                  <svg width="12" height="12" viewBox="0 0 16 16" className="shrink-0 animate-spin text-content-tertiary">
                    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="28 10" strokeLinecap="round" />
                  </svg>
                ) : isRolledBack ? (
                  <span className="text-semantic-error/60 shrink-0 text-xs w-[12px] text-center">×</span>
                ) : (
                  <span className="text-content-tertiary/60 shrink-0 text-xs w-[12px] text-center">+</span>
                )}
                <span className={`text-xs leading-snug truncate min-w-0 flex-1 ${isRolledBack ? 'line-through text-content-tertiary' : isCurrent ? 'font-medium text-content-primary' : 'text-content-secondary'}`}>
                  {f.title || f.prompt}
                </span>
                {!isRolledBack && hasRewindPoint && onRollback && (
                  <button
                    onClick={() => onRollback(i + 1)}
                    className="shrink-0 p-1 rounded text-content-tertiary/40 hover:text-semantic-error hover:bg-semantic-error-bg/10 opacity-0 group-hover/step:opacity-100 transition-all"
                    title={`Roll back to after follow-up #${i}`}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M2 6h5M4.5 3.5L2 6l2.5 2.5M10 3v6" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

/* ─── Edited Files ─── */

interface EditedFile {
  path: string;
  tool: string; // 'Write' | 'Edit' | etc.
}

const EditedFilesList = memo(function EditedFilesList({ files, projectId }: { files: EditedFile[]; projectId: string }) {
  if (files.length === 0) return null;

  const handleFileClick = (filePath: string) => {
    window.electronAPI.filesOpenInEditor(projectId, filePath).catch((err) => {
      console.error('[EditedFilesList] Failed to open file:', err);
    });
  };

  return (
    <div className="mt-3">
      <div className="text-[10px] font-semibold text-content-tertiary uppercase tracking-wider mb-1.5">
        {files.length} file{files.length !== 1 ? 's' : ''} touched
      </div>
      <div className="space-y-px">
        {files.map((file) => {
          const parts = file.path.split('/');
          const fileName = parts.pop() || file.path;
          const dirPath = parts.length > 0 ? parts.join('/') + '/' : '';
          // Shorten long dir paths to last 3 segments
          const shortDir = parts.length > 3
            ? '.../' + parts.slice(-3).join('/') + '/'
            : dirPath;

          return (
            <div
              key={file.path}
              className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-tertiary/40 transition-colors group cursor-pointer"
              onClick={() => handleFileClick(file.path)}
              title={`Open ${file.path} in editor`}
            >
              {/* File icon */}
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-content-tertiary">
                <path d="M9 2H4a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V6L9 2z" />
                <path d="M9 2v4h4" />
              </svg>
              {/* Path */}
              <span className="text-[11px] font-mono truncate min-w-0">
                <span className="text-content-tertiary">{shortDir}</span>
                <span className="text-content-primary font-medium">{fileName}</span>
              </span>
              {/* Open-in-editor icon (visible on hover) */}
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-content-tertiary/60 opacity-0 group-hover:opacity-100 transition-opacity ml-auto">
                <path d="M7 3H3a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1v-4" />
                <path d="M14 2l-7 7" />
                <path d="M10 2h4v4" />
              </svg>
              {/* Tool badge */}
              <span className="shrink-0 text-[9px] font-medium text-content-tertiary/60 uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity">
                {file.tool === 'Write' ? 'new' : 'edit'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
});
