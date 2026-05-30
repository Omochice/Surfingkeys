export type DebouncedFunction = {
  (): void;
  cancel: () => void;
};

export function debounce(fn: () => void, wait: number): DebouncedFunction {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const debounced = () => {
    if (timer != null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      fn();
    }, wait);
  };
  debounced.cancel = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  return debounced;
}
