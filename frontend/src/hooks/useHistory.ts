import { useState, useRef } from "react";

export function useHistory<T>(initial: T, debounceMs = 400) {
  const [stack, setStack] = useState<T[]>([initial]);
  const [index, setIndex] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const push = (state: T) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setStack((prev) => {
        const newStack = [...prev.slice(0, index + 1), state].slice(-50);
        setIndex(newStack.length - 1);
        return newStack;
      });
    }, debounceMs);
  };

  const undo = () => {
    if (index > 0) setIndex((i) => i - 1);
  };
  const redo = () => {
    if (index < stack.length - 1) setIndex((i) => i + 1);
  };

  return {
    current: stack[index],
    push,
    undo,
    redo,
    canUndo: index > 0,
    canRedo: index < stack.length - 1,
  };
}
