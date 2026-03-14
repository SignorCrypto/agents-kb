import { useEffect, useCallback, useState } from 'react';
import type { AttachedImage } from '../hooks/useImageAttachment';

interface ImageLightboxProps {
  images: AttachedImage[];
  initialIndex: number;
  onClose: () => void;
}

/**
 * Full-screen lightbox for previewing attached images.
 * Supports keyboard navigation (← → Esc) and click-to-close backdrop.
 */
export function ImageLightbox({ images, initialIndex, onClose }: ImageLightboxProps) {
  const [index, setIndex] = useState(initialIndex);
  const image = images[index];
  const hasMultiple = images.length > 1;

  const goNext = useCallback(() => {
    setIndex((i) => (i + 1) % images.length);
  }, [images.length]);

  const goPrev = useCallback(() => {
    setIndex((i) => (i - 1 + images.length) % images.length);
  }, [images.length]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && hasMultiple) goNext();
      if (e.key === 'ArrowLeft' && hasMultiple) goPrev();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, goNext, goPrev, hasMultiple]);

  if (!image) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ animation: 'lightboxFadeIn 150ms ease-out' }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-surface-overlay/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center gap-3 max-w-[90vw] max-h-[90vh]">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute -top-2 -right-2 z-20 w-7 h-7 rounded-full bg-surface-elevated/90 border border-chrome/50 flex items-center justify-center text-content-secondary hover:text-content-primary hover:bg-surface-elevated transition-colors shadow-lg"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M2 2l8 8M10 2l-8 8" />
          </svg>
        </button>

        {/* Image */}
        <img
          src={image.dataUrl}
          alt={image.name}
          className="max-w-[85vw] max-h-[80vh] rounded-lg shadow-2xl object-contain"
          style={{ animation: 'lightboxScaleIn 200ms ease-out' }}
        />

        {/* Footer — filename + navigation */}
        <div className="flex items-center gap-3">
          {hasMultiple && (
            <button
              onClick={goPrev}
              className="w-7 h-7 rounded-full bg-surface-elevated/80 border border-chrome/40 flex items-center justify-center text-content-secondary hover:text-content-primary hover:bg-surface-elevated transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2L3 5l3 3" />
              </svg>
            </button>
          )}

          <span className="text-xs text-content-secondary/80 select-none px-1">
            {image.name}
            {hasMultiple && (
              <span className="ml-1.5 text-content-tertiary">
                {index + 1}/{images.length}
              </span>
            )}
          </span>

          {hasMultiple && (
            <button
              onClick={goNext}
              className="w-7 h-7 rounded-full bg-surface-elevated/80 border border-chrome/40 flex items-center justify-center text-content-secondary hover:text-content-primary hover:bg-surface-elevated transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 2l3 3-3 3" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
