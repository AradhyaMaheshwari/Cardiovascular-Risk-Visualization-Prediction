import {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  type HTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type RefAttributes,
  type RefObject,
} from 'react';
import { gsap } from 'gsap';
import './card-swap.css';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  customClass?: string;
}

export interface CardSwapProps {
  width?: number | string;
  height?: number | string;
  cardDistance?: number;
  verticalDistance?: number;
  onCardClick?: (index: number) => void;
  skewAmount?: number;
  easing?: 'linear' | 'elastic';
  children: ReactNode;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(({ customClass = '', className = '', ...props }, ref) => (
  <div ref={ref} {...props} className={`card-swap-card ${customClass} ${className}`.trim()} />
));
Card.displayName = 'Card';

interface Slot { x: number; y: number; z: number; zIndex: number }
type CardRef = RefObject<HTMLDivElement | null>;

const makeSlot = (index: number, distanceX: number, distanceY: number, total: number): Slot => ({
  x: index * distanceX,
  y: -index * distanceY,
  z: -index * distanceX * 1.5,
  zIndex: total - index,
});

const placeCard = (element: HTMLElement, slot: Slot, skew: number) => gsap.set(element, {
  x: slot.x,
  y: slot.y,
  z: slot.z,
  xPercent: -50,
  yPercent: -50,
  skewY: skew,
  transformOrigin: 'center center',
  zIndex: slot.zIndex,
  force3D: true,
});

export function CardSwap({
  width = 500,
  height = 400,
  cardDistance = 60,
  verticalDistance = 70,
  onCardClick,
  skewAmount = 6,
  easing = 'elastic',
  children,
}: CardSwapProps) {
  const cards = useMemo(() => Children.toArray(children) as ReactElement<CardProps>[], [children]);
  const refs = useMemo<CardRef[]>(() => cards.map(() => ({ current: null })), [cards.length]);
  const order = useRef<number[]>(cards.map((_, index) => index));
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigateRef = useRef<((direction: 'previous' | 'next') => void) | null>(null);

  const config = easing === 'elastic'
    ? { ease: 'elastic.out(0.6,0.9)', drop: 1.1, move: 1.1, back: 1.1, overlap: 0.8, returnDelay: 0.05 }
    : { ease: 'power1.inOut', drop: 0.55, move: 0.55, back: 0.55, overlap: 0.45, returnDelay: 0.2 };

  useEffect(() => {
    order.current = cards.map((_, index) => index);
    refs.forEach((ref, index) => {
      if (ref.current) placeCard(ref.current, makeSlot(index, cardDistance, verticalDistance, refs.length), skewAmount);
    });

    const swap = (direction: 'previous' | 'next' = 'next') => {
      if (order.current.length < 2 || timelineRef.current?.isActive()) return;
      const currentOrder = order.current;
      if (direction === 'previous') {
        const back = currentOrder[currentOrder.length - 1];
        const backElement = refs[back]?.current;
        if (!backElement) return;
        const timeline = gsap.timeline();
        timelineRef.current = timeline;
        timeline.set(backElement, { zIndex: currentOrder.length + 1 });
        timeline.to(backElement, { ...makeSlot(0, cardDistance, verticalDistance, refs.length), duration: config.move, ease: config.ease });
        currentOrder.slice(0, -1).forEach((index, position) => {
          const element = refs[index]?.current;
          if (!element) return;
          timeline.to(element, { ...makeSlot(position + 1, cardDistance, verticalDistance, refs.length), duration: config.move, ease: config.ease }, 0);
        });
        timeline.call(() => { order.current = [back, ...currentOrder.slice(0, -1)]; });
        return;
      }

      const [front, ...rest] = currentOrder;
      const frontElement = refs[front]?.current;
      if (!frontElement) return;

      const timeline = gsap.timeline();
      timelineRef.current = timeline;
      timeline.to(frontElement, { y: '+=500', duration: config.drop, ease: config.ease });
      timeline.addLabel('promote', `-=${config.drop * config.overlap}`);
      rest.forEach((index, position) => {
        const element = refs[index]?.current;
        if (!element) return;
        const slot = makeSlot(position, cardDistance, verticalDistance, refs.length);
        timeline.set(element, { zIndex: slot.zIndex }, 'promote');
        timeline.to(element, { ...slot, duration: config.move, ease: config.ease }, `promote+=${position * 0.12}`);
      });
      const backSlot = makeSlot(refs.length - 1, cardDistance, verticalDistance, refs.length);
      timeline.addLabel('return', `promote+=${config.move * config.returnDelay}`);
      timeline.call(() => gsap.set(frontElement, { zIndex: backSlot.zIndex }), undefined, 'return');
      timeline.to(frontElement, { ...backSlot, duration: config.back, ease: config.ease }, 'return');
      timeline.call(() => { order.current = [...rest, front]; });
    };
    navigateRef.current = swap;

    let wheelDelta = 0;
    const node = containerRef.current;
    const onWheel = (event: WheelEvent) => {
      if (!event.deltaY) return;
      event.preventDefault();
      wheelDelta += event.deltaY;
      if (Math.abs(wheelDelta) < 60) return;
      const direction = wheelDelta > 0 ? 'next' : 'previous';
      wheelDelta = 0;
      swap(direction);
    };
    node?.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      node?.removeEventListener('wheel', onWheel);
      navigateRef.current = null;
      timelineRef.current?.kill();
      refs.forEach((ref) => { if (ref.current) gsap.killTweensOf(ref.current); });
    };
  }, [cardDistance, verticalDistance, skewAmount, easing, refs, cards.length]);

  const renderedCards = cards.map((card, index) => isValidElement<CardProps>(card)
    ? cloneElement(card, {
        key: card.key ?? index,
        ref: refs[index],
        style: { width, height, ...card.props.style },
        onClick: (event: MouseEvent<HTMLDivElement>) => {
          card.props.onClick?.(event);
          onCardClick?.(index);
        },
      } as CardProps & RefAttributes<HTMLDivElement>)
    : card);

  return (
    <>
      <div ref={containerRef} className="card-swap-stage" style={{ width, height }}>
        {renderedCards}
      </div>
      <div className="card-swap-controls" role="group" aria-label="Prediction card controls">
        <button type="button" aria-label="Previous prediction" onClick={() => navigateRef.current?.('previous')}>‹</button>
        <button type="button" aria-label="Next prediction" onClick={() => navigateRef.current?.('next')}>›</button>
      </div>
    </>
  );
}

export default CardSwap;
