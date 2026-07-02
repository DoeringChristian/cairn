/**
 * A simple bounded FIFO cache: once `maxEntries` is reached, the oldest
 * inserted key is evicted to make room for the next one.
 */
function createFifoCache<T>(maxEntries: number) {
  const cache = new Map<string, T>();
  return {
    get(key: string): T | undefined {
      return cache.get(key);
    },
    set(key: string, value: T): void {
      if (cache.size >= maxEntries) {
        const firstKey = cache.keys().next().value;
        if (firstKey !== undefined) cache.delete(firstKey);
      }
      cache.set(key, value);
    },
  };
}

// Diff / false-color render results (keyed by url+mode+colormap combos).
const IMAGE_DATA_CACHE_MAX = 50;
const imageDataCache = createFifoCache<ImageData>(IMAGE_DATA_CACHE_MAX);

export function getCachedImageData(key: string): ImageData | undefined {
  return imageDataCache.get(key);
}

export function setCachedImageData(key: string, data: ImageData): void {
  imageDataCache.set(key, data);
}

// Raw decoded ImageData from `loadImageData` (keyed by url).
const IMAGE_LOAD_CACHE_MAX = 100;
const imageLoadCache = createFifoCache<ImageData>(IMAGE_LOAD_CACHE_MAX);

export function getCachedLoadedImageData(key: string): ImageData | undefined {
  return imageLoadCache.get(key);
}

export function setCachedLoadedImageData(key: string, data: ImageData): void {
  imageLoadCache.set(key, data);
}
