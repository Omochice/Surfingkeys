export type DebouncedFunction = {
  (): void;
  cancel: () => void;
};

export function debounce(fn: () => void, wait: number): DebouncedFunction {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const debounced = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(fn, wait);
  };
  debounced.cancel = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  return debounced;
}
