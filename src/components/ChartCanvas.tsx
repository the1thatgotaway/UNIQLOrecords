import { useEffect, useRef } from 'react';
import Chart, { type ChartConfiguration, type Plugin } from 'chart.js/auto';

interface ChartCanvasProps {
  id?: string;
  config: ChartConfiguration;
  plugins?: Plugin[];
  containerClassName?: string;
  ariaLabel: string;
  isLight?: boolean;
  onFirstRender?: (milliseconds: number) => void;
  onCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
}

export function ChartCanvas({
  id,
  config,
  plugins,
  containerClassName = 'chart-container',
  ariaLabel,
  isLight = false,
  onFirstRender,
  onCanvasReady,
}: ChartCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    Chart.defaults.color = isLight ? '#513e46' : '#dccbd1';
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

    Chart.defaults.color = isLight ? '#513e46' : '#dccbd1';
    Chart.defaults.borderColor = isLight ? '#d9e4f2' : '#2a3954';

    const started = performance.now();
    let firstRender = true;
    const renderTiming: Plugin = {
      id: 'comparisonRenderTiming',
      afterRender() {
        if (!firstRender) return;
        firstRender = false;
        onFirstRender?.(performance.now() - started);
      },
    };

    chartRef.current = new Chart(canvas, {
      ...config,
      plugins: onFirstRender ? [...(plugins ?? []), renderTiming] : plugins,
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
      onCanvasReady?.(null);
    };
  }, [config, plugins, onCanvasReady, onFirstRender, isLight]);

  return (
    <div className={containerClassName}>
      <canvas id={id} ref={canvasRef} aria-label={ariaLabel} role="img" />
    </div>
  );
}
