import { useEffect, useState } from 'react';

type Target = 'Cath' | 'LAD' | 'LCX' | 'RCA';
type Prediction = { score: number; prediction: number; threshold: number };

const predictions: Array<{
  target: Target;
  title: string;
  vessel: string;
  symbol: string;
  className: string;
  threshold: number;
  auc: string;
}> = [
  { target: 'Cath', title: 'Overall CAD', vessel: 'Overall coronary artery disease', symbol: '⌁', className: 'cath', threshold: 0.65, auc: '0.933' },
  { target: 'LAD', title: 'LAD', vessel: 'Left anterior descending', symbol: '↗', className: 'lad', threshold: 0.49, auc: '0.853' },
  { target: 'LCX', title: 'LCX', vessel: 'Left circumflex', symbol: '⌁', className: 'lcx', threshold: 0.39, auc: '0.735' },
  { target: 'RCA', title: 'RCA', vessel: 'Right coronary artery', symbol: '⌁', className: 'rca', threshold: 0.35, auc: '0.757' },
];

function selectTarget(target: Target) {
  document.dispatchEvent(new CustomEvent('cardio:select-target', { detail: { target } }));
}

export function PredictionCardDeck() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [results, setResults] = useState<Partial<Record<Target, Prediction>>>({});
  const item = predictions[activeIndex];
  const result = results[item.target];
  const score = result ? result.score * 100 : null;
  const threshold = result?.threshold ?? item.threshold;
  const aboveThreshold = result ? Boolean(result.prediction) : null;

  useEffect(() => {
    const handlePredictions = (event: Event) => {
      const next = (event as CustomEvent<Partial<Record<Target, Prediction>> | null>).detail;
      setResults(next || {});
    };
    document.addEventListener('cardio:prediction-update', handlePredictions);
    return () => document.removeEventListener('cardio:prediction-update', handlePredictions);
  }, []);

  const move = (step: number) => {
    const nextIndex = (activeIndex + step + predictions.length) % predictions.length;
    setActiveIndex(nextIndex);
    selectTarget(predictions[nextIndex].target);
  };

  return (
    <section className="metric-carousel" aria-label="Model output carousel" aria-roledescription="carousel">
      <button className="metric-carousel-arrow" type="button" aria-label="Previous model output" onClick={() => move(-1)}>‹</button>
      <article className={`metric-card metric-card--${item.className} metric-carousel-card active`} data-target={item.target} aria-live="polite" aria-label={`${item.title} model output, ${activeIndex + 1} of ${predictions.length}`}>
        <div className="metric-carousel-heading">
          <div>
            <span className="metric-kicker">{item.title}</span>
            <p className="metric-carousel-vessel">{item.vessel}</p>
          </div>
          <span className={`metric-symbol metric-symbol--${item.className}`} aria-hidden="true">{item.symbol}</span>
        </div>
        <div className="metric-carousel-scoreline">
          <div>
            <span className="small-label">MODEL-ESTIMATED SCORE</span>
            <strong className="metric-carousel-score">{score === null ? '—' : `${score.toFixed(1)}%`}</strong>
          </div>
          <span className={`metric-carousel-status ${aboveThreshold === null ? '' : aboveThreshold ? 'positive' : 'negative'}`}>
            {aboveThreshold === null ? 'Awaiting input' : aboveThreshold ? 'Above threshold' : 'Below threshold'}
          </span>
        </div>
        <div className="metric-carousel-track" role="meter" aria-label={`${item.title} model score`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={score ?? 0}>
          <span style={{ width: `${score ?? 0}%` }} />
          <i style={{ left: `${threshold * 100}%` }} />
        </div>
        <div className="metric-carousel-details">
          <div><span>DECISION THRESHOLD</span><strong>{(threshold * 100).toFixed(0)}%</strong></div>
          <div><span>CV ROC–AUC</span><strong>{item.auc}</strong></div>
          <span className="metric-carousel-count">{String(activeIndex + 1).padStart(2, '0')} <i>/</i> {String(predictions.length).padStart(2, '0')}</span>
        </div>
      </article>
      <button className="metric-carousel-arrow" type="button" aria-label="Next model output" onClick={() => move(1)}>›</button>
    </section>
  );
}
