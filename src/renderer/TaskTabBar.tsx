import { Loader2, Plus, X, Play, Layers } from "lucide-react";
import type { UiCopy } from "./i18n";
import { useTaskStoreVersion, type TaskFieldStore } from "./taskStore";

interface TaskTabBarProps {
  store: TaskFieldStore;
  taskIds: string[];
  activeTaskId: string;
  concurrency: number;
  copy: UiCopy;
  onSwitch(taskId: string): void;
  onClose(taskId: string): void;
  onAdd(): void;
  onConcurrencyChange(next: number): void;
  onRunAll(): void;
}

export function taskTabLabel(store: TaskFieldStore, taskId: string, index: number, copy: UiCopy): string {
  const prompt = store.get(taskId, "prompt");
  if (typeof prompt === "string" && prompt.trim()) {
    return prompt.trim().slice(0, 14);
  }
  return `${copy.taskLabel} ${index + 1}`;
}

export function TaskTabBar({
  store,
  taskIds,
  activeTaskId,
  concurrency,
  copy,
  onSwitch,
  onClose,
  onAdd,
  onConcurrencyChange,
  onRunAll
}: TaskTabBarProps) {
  useTaskStoreVersion(store);
  const anyRunning = taskIds.some((taskId) => store.get(taskId, "isRunning") === true);

  return (
    <div className="task-tab-bar" role="tablist" aria-label={copy.taskLabel}>
      {taskIds.map((taskId, index) => {
        const isActive = taskId === activeTaskId;
        const running = store.get(taskId, "isRunning") === true;
        const label = taskTabLabel(store, taskId, index, copy);
        return (
          <div
            key={taskId}
            role="tab"
            aria-selected={isActive}
            className={["task-tab", isActive ? "active" : "", running ? "running" : ""].filter(Boolean).join(" ")}
            tabIndex={0}
            onClick={() => onSwitch(taskId)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSwitch(taskId);
              }
            }}
          >
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
      <span className="task-tab-spacer" />
      <label className="task-concurrency" title={copy.taskConcurrency}>
        <Layers size={13} />
        <span>{copy.taskConcurrency}</span>
        <select
          aria-label={copy.taskConcurrency}
          value={concurrency}
          onChange={(event) => onConcurrencyChange(Number(event.target.value))}
        >
          {[1, 2, 3, 4, 5, 6, 7, 8].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="task-run-all"
        disabled={anyRunning}
        onClick={onRunAll}
        aria-label={copy.taskRunAll}
      >
        <Play size={13} />
        <span>{copy.taskRunAll}</span>
      </button>
    </div>
  );
}
