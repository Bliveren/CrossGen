import { Loader2, Plus, X, Play } from "lucide-react";
import type { UiCopy } from "./i18n";
import { useTaskStoreVersion, type TaskFieldStore } from "./taskStore";

interface TaskTabBarProps {
  store: TaskFieldStore;
  taskIds: string[];
  activeTaskId: string;
  copy: UiCopy;
  onSwitch(taskId: string): void;
  onClose(taskId: string): void;
  onAdd(): void;
  onToggleEnabled(taskId: string, enabled: boolean): void;
}

interface TaskRunControlsProps {
  copy: UiCopy;
  enabledCount: number;
  totalCount: number;
  onRunAll(): void;
}

export function taskTabLabel(store: TaskFieldStore, taskId: string, index: number, copy: UiCopy): string {
  const prompt = store.get(taskId, "prompt");
  if (typeof prompt === "string" && prompt.trim()) {
    return prompt.trim().slice(0, 14);
  }
  return `${copy.taskLabel} ${index + 1}`;
}

export function isTaskEnabled(store: TaskFieldStore, taskId: string): boolean {
  return store.get(taskId, "enabled") !== false;
}

/** 标签条：只负责展示/切换任务页签与启停勾选，可横向滚动；并发显示与“全部运行”在 TaskRunControls。 */
export function TaskTabBar({
  store,
  taskIds,
  activeTaskId,
  copy,
  onSwitch,
  onClose,
  onAdd,
  onToggleEnabled
}: TaskTabBarProps) {
  useTaskStoreVersion(store);

  return (
    <div className="task-tab-strip" role="tablist" aria-label={copy.taskLabel}>
      {taskIds.map((taskId, index) => {
        const isActive = taskId === activeTaskId;
        const running = store.get(taskId, "isRunning") === true;
        const queued = running && store.get(taskId, "runningJobId") == null;
        const enabled = isTaskEnabled(store, taskId);
        const label = taskTabLabel(store, taskId, index, copy);
        return (
          <div
            key={taskId}
            role="tab"
            aria-selected={isActive}
            className={[
              "task-tab",
              isActive ? "active" : "",
              running ? (queued ? "queued" : "running") : "",
              enabled ? "" : "disabled"
            ].filter(Boolean).join(" ")}
            tabIndex={0}
            onClick={() => onSwitch(taskId)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSwitch(taskId);
              }
            }}
          >
            <label
              className="task-tab-enabled"
              title={copy.taskToggleEnabled}
              onClick={(event) => event.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => onToggleEnabled(taskId, event.target.checked)}
                aria-label={copy.taskToggleEnabled}
              />
            </label>
            {running && <Loader2 className="spin task-tab-spinner" size={12} />}
            <span className="task-tab-label">{label}</span>
            {taskIds.length > 1 && (
              <button
                type="button"
                className="icon-button task-tab-close"
                aria-label={copy.taskClose}
                data-tooltip={copy.taskClose}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(taskId);
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        );
      })}
      <button
        type="button"
        className="icon-button task-tab-add"
        aria-label={copy.taskAdd}
        data-tooltip={copy.taskAdd}
        onClick={onAdd}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

/** 运行控制区：显示已勾选（启用）的任务数，以及“全部运行”。固定在标签条右侧，不随标签溢出被挤走。 */
export function TaskRunControls({ copy, enabledCount, totalCount, onRunAll }: TaskRunControlsProps) {
  return (
    <div className="task-run-controls">
      <span className="task-concurrency" title={copy.taskConcurrency}>
        <span>{copy.taskEnabledCount(enabledCount, totalCount)}</span>
      </span>
      <button
        type="button"
        className="task-run-all"
        disabled={enabledCount === 0}
        onClick={onRunAll}
        aria-label={copy.taskRunAll}
      >
        <Play size={13} />
        <span>{copy.taskRunAll}</span>
      </button>
    </div>
  );
}
