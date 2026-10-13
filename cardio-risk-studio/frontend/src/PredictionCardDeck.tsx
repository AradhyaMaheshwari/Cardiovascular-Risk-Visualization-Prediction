import { useEffect, useState } from 'react';
import { Card, CardSwap } from '@/components/ui/card-swap';

const predictions = [
  { target: 'Cath', vessel: 'OVERALL CAD', symbol: '⌁', className: 'cath', threshold: '65%' },
  { target: 'LAD', vessel: 'LAD VESSEL', symbol: '↗', className: 'lad', threshold: '49%' },
  { target: 'LCX', vessel: 'LCX VESSEL', symbol: '⌁', className: 'lcx', threshold: '39%' },
  { target: 'RCA', vessel: 'RCA VESSEL', symbol: '⌁', className: 'rca', threshold: '35%' },
];

function selectTarget(target: string) {
  document.dispatchEvent(new CustomEvent('cardio:select-target', { detail: { target } }));
}

export function PredictionCardDeck() {
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);

  useEffect(() => {
    const update = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const compact = viewportWidth <= 600;
  const cardWidth = compact
    ? 'min(80vw, 440px)'
    : viewportWidth <= 900
      ? 'min(calc(100vw - 120px), 600px)'
      : viewportWidth <= 1050
        ? 'min(calc(41vw - 10px), 440px)'
        : 'min(calc(100vw - min(47vw, 790px) - 147px), 980px)';

  return (
    <CardSwap
      width={cardWidth}
      height="min(54svh, 440px)"
      cardDistance={compact ? 9 : 13}
      verticalDistance={compact ? 8 : 10}
      skewAmount={1}
      easing="linear"
      onCardClick={(index) => selectTarget(predictions[index].target)}
    >
      {predictions.map(({ target, vessel, symbol, className, threshold }) => (
        <Card
          key={target}
          customClass={`metric-card metric-card--${className}`}
          data-target={target}
          role="button"
          tabIndex={0}
          aria-label={`Select ${vessel} prediction card`}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.currentTarget.click();
            }
          }}
        >
          <div className="metric-top">
            <span className="metric-kicker">{vessel}</span>
            <span className={`metric-symbol metric-symbol--${className}`}>{symbol}</span>
          </div>
          <div className="metric-main">
            <strong className="metric-value" id={`score-${target}`}>—</strong>
            <span className="metric-unit">model score</span>
          </div>
          <div className="metric-track"><span id={`bar-${target}`} /></div>
          <div className="metric-bottom">
            <span id={`status-${target}`} className="metric-status">Awaiting input</span>
            <span className="metric-threshold">T <b id={`threshold-${target}`}>{threshold}</b></span>
          </div>
        </Card>
      ))}
    </CardSwap>
  );
}
