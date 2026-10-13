import { useEffect, useState } from 'react';
import { PillNav, type PillNavItem } from '@/components/ui/pill-nav';

const items: PillNavItem[] = [
  { label: 'Overview', href: '#overview' },
  { label: 'Patient inputs', count: 55, onClick: () => document.dispatchEvent(new Event('cardio:open-inputs')) },
  { label: 'Coronary map', href: '#coronary-map' },
  { label: 'Explainability', href: '#explainability' },
];

export function HeaderNav() {
  const [activeHref, setActiveHref] = useState(window.location.hash || '#overview');

  useEffect(() => {
    const updateActive = () => setActiveHref(window.location.hash || '#overview');
    window.addEventListener('hashchange', updateActive);
    return () => window.removeEventListener('hashchange', updateActive);
  }, []);

  return <PillNav items={items} activeHref={activeHref} />;
}
