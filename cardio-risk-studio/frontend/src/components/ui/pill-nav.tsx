import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { gsap } from 'gsap';
import { IoCloseOutline, IoMenuOutline } from 'react-icons/io5';
import { GlassButton } from '@/components/ui/glass-button';
import './pill-nav.css';

export interface PillNavItem {
  label: string;
  href?: string;
  count?: number;
  ariaLabel?: string;
  onClick?: () => void;
}

interface PillNavProps {
  items: PillNavItem[];
  activeHref?: string;
  className?: string;
  ease?: string;
  baseColor?: string;
  pillColor?: string;
  pillTextColor?: string;
  hoveredPillTextColor?: string;
  initialLoadAnimation?: boolean;
}

export function PillNav({
  items,
  activeHref,
  className = '',
  ease = 'power3.out',
  baseColor = '#292522',
  pillColor = '#141210',
  pillTextColor = '#c8bdb4',
  hoveredPillTextColor = '#fff',
  initialLoadAnimation = true,
}: PillNavProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const navItemsRef = useRef<HTMLUListElement>(null);
  const circleRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const timelineRefs = useRef<Array<gsap.core.Timeline | null>>([]);
  const tweenRefs = useRef<Array<gsap.core.Tween | null>>([]);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useRef(false);

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReducedMotion.current = reduceMotion.matches;

    const layout = () => {
      circleRefs.current.forEach((circle, index) => {
        const pill = circle?.parentElement;
        if (!circle || !pill) return;
        const { width, height } = pill.getBoundingClientRect();
        if (!width || !height) return;

        const radius = (width * width / 4 + height * height) / (2 * height);
        const diameter = Math.ceil(2 * radius) + 2;
        const delta = Math.ceil(radius - Math.sqrt(Math.max(0, radius * radius - width * width / 4))) + 1;
        circle.style.width = `${diameter}px`;
        circle.style.height = `${diameter}px`;
        circle.style.bottom = `-${delta}px`;
        gsap.set(circle, { xPercent: -50, scale: 0, transformOrigin: `50% ${diameter - delta}px` });

        const label = pill.querySelector<HTMLElement>('.pill-label');
        const hoverLabel = pill.querySelector<HTMLElement>('.pill-label-hover');
        if (label) gsap.set(label, { y: 0 });
        if (hoverLabel) gsap.set(hoverLabel, { y: height + 16, opacity: 0 });

        timelineRefs.current[index]?.kill();
        const timeline = gsap.timeline({ paused: true });
        timeline.to(circle, { scale: 1.2, duration: 0.8, ease, overwrite: 'auto' }, 0);
        if (label) timeline.to(label, { y: -(height + 8), duration: 0.6, ease, overwrite: 'auto' }, 0);
        if (hoverLabel) timeline.to(hoverLabel, { y: 0, opacity: 1, duration: 0.6, ease, overwrite: 'auto' }, 0);
        timelineRefs.current[index] = timeline;
      });
    };

    layout();
    window.addEventListener('resize', layout);
    document.fonts?.ready.then(layout).catch(() => {});

    if (initialLoadAnimation && !prefersReducedMotion.current && navItemsRef.current) {
      gsap.fromTo(navItemsRef.current.children, { opacity: 0, x: -16 }, {
        opacity: 1, x: 0, duration: 0.45, stagger: 0.05, ease: 'power2.out',
      });
    }

    return () => {
      window.removeEventListener('resize', layout);
      timelineRefs.current.forEach((timeline) => timeline?.kill());
      tweenRefs.current.forEach((tween) => tween?.kill());
    };
  }, [ease, initialLoadAnimation, items]);

  const animatePill = (index: number, open: boolean) => {
    const timeline = timelineRefs.current[index];
    if (!timeline) return;
    tweenRefs.current[index]?.kill();
    if (prefersReducedMotion.current) {
      timeline.progress(open ? 1 : 0);
      return;
    }
    tweenRefs.current[index] = timeline.tweenTo(open ? timeline.duration() : 0, {
      duration: open ? 0.4 : 0.3,
      ease,
      overwrite: 'auto',
    });
  };

  const closeMobileMenu = () => {
    const menu = mobileMenuRef.current;
    setIsMobileMenuOpen(false);
    if (!menu) return;
    if (prefersReducedMotion.current) {
      gsap.set(menu, { display: 'none' });
      return;
    }
    gsap.to(menu, { opacity: 0, y: -12, duration: 0.2, ease: 'power2.in', onComplete: () => gsap.set(menu, { display: 'none' }) });
  };

  const toggleMobileMenu = () => {
    const menu = mobileMenuRef.current;
    if (!menu) return;
    if (isMobileMenuOpen) {
      closeMobileMenu();
      return;
    }
    setIsMobileMenuOpen(true);
    if (prefersReducedMotion.current) {
      gsap.set(menu, { display: 'block', opacity: 1, y: 0 });
      return;
    }
    gsap.set(menu, { display: 'block', opacity: 0, y: -12 });
    gsap.to(menu, { opacity: 1, y: 0, duration: 0.28, ease: 'power3.out' });
  };

  const cssVars = {
    '--pill-base': baseColor,
    '--pill-bg': pillColor,
    '--pill-text': pillTextColor,
    '--pill-hover-text': hoveredPillTextColor,
    '--pill-height': '48px',
    '--pill-padding': '20px',
    '--pill-gap': '6px',
  } as CSSProperties;

  const renderItem = (item: PillNavItem, index: number, mobile = false): ReactNode => {
    const label = <>{item.label}{item.count !== undefined && <span className="pill-count">{item.count}</span>}</>;
    const content = mobile ? label : (
      <>
        <span className="pill-hover-circle" aria-hidden="true" ref={(el) => { circleRefs.current[index] = el; }} />
        <span className="pill-label-stack">
          <span className="pill-label">{label}</span>
          <span className="pill-label-hover" aria-hidden="true">{label}</span>
        </span>
        {activeHref === item.href && <span className="pill-active-dot" aria-hidden="true" />}
      </>
    );
    const commonProps = {
      className: mobile ? 'pill-mobile-link glass-button' : 'pill-link glass-button',
      'aria-label': item.ariaLabel || item.label,
      onClick: () => {
        item.onClick?.();
        if (mobile) closeMobileMenu();
      },
    };

    return item.href ? (
      <a
        {...commonProps}
        key={`${mobile ? 'mobile-' : ''}${item.label}`}
        href={item.href}
        aria-current={activeHref === item.href ? 'page' : undefined}
        onMouseEnter={mobile ? undefined : () => animatePill(index, true)}
        onMouseLeave={mobile ? undefined : () => animatePill(index, false)}
        onFocus={mobile ? undefined : () => animatePill(index, true)}
        onBlur={mobile ? undefined : () => animatePill(index, false)}
      >
        {content}
      </a>
    ) : (
      <GlassButton {...commonProps} key={`${mobile ? 'mobile-' : ''}${item.label}`} type="button" onMouseEnter={mobile ? undefined : () => animatePill(index, true)} onMouseLeave={mobile ? undefined : () => animatePill(index, false)} onFocus={mobile ? undefined : () => animatePill(index, true)} onBlur={mobile ? undefined : () => animatePill(index, false)}>
        {content}
      </GlassButton>
    );
  };

  return (
    <div className={`pill-nav ${className}`} style={cssVars}>
      <nav className="pill-nav__desktop" aria-label="Dashboard navigation">
        <ul ref={navItemsRef}>{items.map((item, index) => <li key={item.label}>{renderItem(item, index)}</li>)}</ul>
      </nav>
      <button
        className="pill-nav__toggle"
        type="button"
        aria-label={isMobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={isMobileMenuOpen}
        aria-controls="pill-mobile-menu"
        onClick={toggleMobileMenu}
      >
        {isMobileMenuOpen ? <IoCloseOutline aria-hidden="true" /> : <IoMenuOutline aria-hidden="true" />}
      </button>
      <div ref={mobileMenuRef} id="pill-mobile-menu" className="pill-nav__mobile" aria-label="Dashboard navigation" style={{ display: 'none' }}>
        {items.map((item, index) => renderItem(item, index, true))}
      </div>
    </div>
  );
}

export default PillNav;
