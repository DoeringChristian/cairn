const IMAGE_DATA_CACHE_MAX = 50;
const imageDataCache = new Map<string, ImageData>();

export function getCachedImageData(key: string): ImageData | undefined {
  return imageDataCache.get(key);
}

export function setCachedImageData(key: string, data: ImageData): void {
  if (imageDataCache.size >= IMAGE_DATA_CACHE_MAX) {
    const firstKey = imageDataCache.keys().next().value;
    if (firstKey !== undefined) imageDataCache.delete(firstKey);
  }
  imageDataCache.set(key, data);
}
