import appIconUrl from '../../../assets/icon.png';

export function SplashScreen() {
  return (
    <div className="flex h-full items-center justify-center bg-surface-primary">
      {/* Drag region for window controls */}
      <div
        className="fixed top-0 left-0 right-0 h-12"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      <div className="flex flex-col items-center gap-5 animate-[splashIn_0.6s_ease-out_both]">
        {/* App icon with glow */}
        <div className="relative">
          <div className="absolute inset-0 rounded-3xl bg-content-tertiary/10 blur-2xl scale-125 animate-[splashPulse_2s_ease-in-out_infinite]" />
          <img
            src={appIconUrl}
            alt="Agents-KB"
            className="relative w-20 h-20 rounded-[18px] shadow-lg"
            draggable={false}
          />
        </div>

        {/* Loading dots */}
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1 h-1 rounded-full bg-content-tertiary"
              style={{
                animation: 'splashDot 1.2s ease-in-out infinite',
                animationDelay: `${i * 0.15}s`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
