import { useEffect, useRef } from 'react';
import Chart, { type ChartConfiguration, type Plugin } from 'chart.js/auto';

interface ChartCanvasProps {
  id?: string;
  config: ChartConfiguration;
  plugins?: Plugin[];
  containerClassName?: string;
  ariaLabel: string;
  isLight?: boolean;
  onCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
}

export function ChartCanvas({
  id,
  config,
  plugins,
  containerClassName = 'chart-container',
  ariaLabel,
  isLight = false,
  onCanvasReady,
}: ChartCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    Chart.defaults.color = isLight ? '#526783' : '#9aaec9';
    Chart.defaults.borderColor = isLight ? '#d9e4f2' : '#2a3954';
    if (chartRef.current) {
      chartRef.current.update();
    }
  }, [isLight]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onCanvasReady?.(canvas);

    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    Chart.defaults.color = isLight ? '#526783' : '#9aaec9';
    Chart.defaults.borderColor = isLight ? '#d9e4f2' : '#2a3954';

    chartRef.current = new Chart(canvas, {
      ...config,
      plugins,
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
      onCanvasReady?.(null);
    };
  }, [config, plugins, onCanvasReady, isLight]);

  return (
    <div className={containerClassName}>
      <canvas id={id} ref={canvasRef} aria-label={ariaLabel} role="img" />
    </div>
  );
}
