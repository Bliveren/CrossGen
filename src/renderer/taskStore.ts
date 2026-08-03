import { useCallback, useSyncExternalStore } from "react";

/**
 * 按 taskId 隔离的前端字段存储（多 task 工作区）。
 * 每个 task 拥有自己的一份字段（提示词/参数/参考图/mask/结果/运行状态等）。
 * App 内部创建一个 store 实例；字段首次访问时缓存初始值，保证 useSyncExternalStore
 * 的 getSnapshot 返回稳定引用；任何写入都会通知所有订阅者（跨 task 写入也能立即反映）。
 */
export interface TaskFieldStore {
  subscribe(listener: () => void): () => void;
  getVersion(): number;
  get(taskId: string, key: string): unknown;
  getOrInit(taskId: string, key: string, initial: unknown): unknown;
  set(taskId: string, key: string, value: unknown): void;
  clearTask(taskId: string): void;
  taskIds(): string[];
}

export function createTaskFieldStore(): TaskFieldStore {
  const fields = new Map<string, Map<string, unknown>>();
  const listeners = new Set<() => void>();
  let version = 0;

  function emit(): void {
    version += 1;
    for (const listener of listeners) listener();
  }

  return {
    getVersion() {
      return version;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get(taskId, key) {
      return fields.get(taskId)?.get(key);
    },
    getOrInit(taskId, key, initial) {
      let taskFields = fields.get(taskId);
      if (!taskFields) {
        taskFields = new Map();
        fields.set(taskId, taskFields);
      }
      if (!taskFields.has(key)) {
        taskFields.set(key, initial);
      }
      return taskFields.get(key);
    },
    set(taskId, key, value) {
      let taskFields = fields.get(taskId);
      if (!taskFields) {
        taskFields = new Map();
        fields.set(taskId, taskFields);
      }
      taskFields.set(key, value);
      emit();
    },
    clearTask(taskId) {
      fields.delete(taskId);
      emit();
    },
    taskIds() {
      return [...fields.keys()];
    }
  };
}

let taskIdCounter = 0;
export function createTaskId(): string {
  taskIdCounter += 1;
  return `task_${Date.now().toString(36)}_${taskIdCounter}`;
}

/** 绑定到某个 taskId 的字段读写；taskId 变化时同一 hook 位置会读取新 task 的值。 */
export function useTaskField<TValue>(
  store: TaskFieldStore,
  taskId: string,
  key: string,
  initial: TValue
): [TValue, (value: TValue | ((current: TValue) => TValue)) => void] {
  const value = useSyncExternalStore(
    store.subscribe,
    () => store.getOrInit(taskId, key, initial) as TValue
  );

  const set = useCallback(
    (next: TValue | ((current: TValue) => TValue)) => {
      const current = store.getOrInit(taskId, key, initial) as TValue;
      const resolved =
        typeof next === "function"
          ? (next as (currentValue: TValue) => TValue)(current)
          : next;
      store.set(taskId, key, resolved);
    },
    [store, taskId, key, initial]
  );

  return [value, set];
}

/** 订阅 store 变更以重渲染（用于任务页签等需要读取非活动 task 字段的 UI）。 */
export function useTaskStoreVersion(store: TaskFieldStore): number {
  return useSyncExternalStore(store.subscribe, () => store.getVersion(), () => 0);
}
