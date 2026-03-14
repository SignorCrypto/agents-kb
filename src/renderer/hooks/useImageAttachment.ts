import { useState, useCallback } from 'react';
import type { JobImage } from '../../shared/types';

/** Renderer-only shape with dataUrl for preview display */
export interface AttachedImage {
  name: string;
  dataUrl: string;
  base64: string;
}

/** Extract MIME type from a data-URL prefix, falling back to image/png */
function extractMediaType(dataUrl: string): JobImage['mediaType'] {
  const match = dataUrl.match(/^data:(image\/\w+);/);
  if (match) {
    const mime = match[1] as JobImage['mediaType'];
    if (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mime)) return mime;
  }
  return 'image/png';
}

/**
 * Reusable hook for image attachment (paste, drag-drop, file picker).
 * Used by NewJobDialog and all ActionArea inputs in JobDetailPanel.
 */
export function useImageAttachment() {
  const [images, setImages] = useState<AttachedImage[]>([]);

  const addImageFromFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      setImages((prev) => [...prev, { name: file.name, dataUrl, base64 }]);
    };
    reader.readAsDataURL(file);
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) addImageFromFile(file);
      }
    }
  }, [addImageFromFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (!files) return;
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        addImageFromFile(file);
      }
    }
  }, [addImageFromFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const removeImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearImages = useCallback(() => setImages([]), []);

  /** Convert renderer AttachedImages to JobImage[] for IPC transport */
  const toJobImages = useCallback((): JobImage[] | undefined => {
    if (images.length === 0) return undefined;
    return images.map((img) => ({
      name: img.name,
      mediaType: extractMediaType(img.dataUrl),
      base64: img.base64,
    }));
  }, [images]);

  const addFiles = useCallback((files: FileList | File[]) => {
    for (const file of files) {
      addImageFromFile(file);
    }
  }, [addImageFromFile]);

  return {
    images,
    addFiles,
    handlePaste,
    handleDrop,
    handleDragOver,
    removeImage,
    clearImages,
    toJobImages,
  };
}
