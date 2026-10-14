import { useEffect, useState } from 'react';
import { PillNav, type PillNavItem } from '@/components/ui/pill-nav';

const items: PillNavItem[] = [
  { label: 'Overview', href: '#overview', onClick: () => navigate('overview') },
  { label: 'Patient inputs', href: '#patient-inputs', count: 55, onClick: () => navigate('inputs') },
  { label: 'Coronary map', href: '#coronary-map', onClick: () => navigate('coronary') },
  { label: 'Explainability', href: '#explainability', onClick: () => navigate('explainability') },
];

function navigate(view: string) {
  document.dispatchEvent(new CustomEvent('cardio:navigate', { detail: { view } }));
}

export function HeaderNav() {
  const [activeHref, setActiveHref] = useState('#overview');

  useEffect(() => {
    const updateActive = (event: Event) => {
      const view = (event as CustomEvent<string>).detail;
      setActiveHref(view === 'inputs' ? '#patient-inputs' : view === 'coronary' ? '#coronary-map' : view === 'explainability' ? '#explainability' : '#overview');
    };
    document.addEventListener('cardio:view-change', updateActive);
    return () => document.removeEventListener('cardio:view-change', updateActive);
  }, []);

  return <PillNav items={items} activeHref={activeHref} />;
}
