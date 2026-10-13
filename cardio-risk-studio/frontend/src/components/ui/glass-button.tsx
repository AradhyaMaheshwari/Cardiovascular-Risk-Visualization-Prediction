'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import './glass-button.css';

export interface GlassButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  render?: React.ReactElement;
}

function GlassButton({ children, render, className, ...props }: GlassButtonProps) {
  return (
    <Button
      asChild={Boolean(render)}
      variant="ghost"
      className={cn('glass-button', className)}
      {...props}
    >
      {render ? React.cloneElement(render, {}, children) : children}
    </Button>
  );
}

export { GlassButton };
