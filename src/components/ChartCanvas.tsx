import { useEffect, useRef } from 'react';
import Chart, { type ChartConfiguration } from 'chart.js/auto';

interface ChartCanvasProps {
  config: ChartConfiguration;
  heightClass?: string;
  ariaLabel: string;
  onCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
}

export function ChartCanvas({
  config,
  heightClass = 'h-72',
  ariaLabel,
  onCanvasReady,
}: ChartCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onCanvasReady?.(canvas);

    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    chartRef.current = new Chart(canvas, config);

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
      onCanvasReady?.(null);
    };
  }, [config, onCanvasReady]);

  return (
    <div className={`relative w-full ${heightClass}`}>
      <canvas ref={canvasRef} aria-label={ariaLabel} role="img" />
    </div>
  );
}
