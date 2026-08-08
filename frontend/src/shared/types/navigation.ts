import type { ReactNode } from 'react';

export interface NavItem {
  label: string;
  href: string;
  icon?: ReactNode;
  badge?: ReactNode;
  /** Nested items render as a collapsible group under this entry. */
  items?: NavItem[];
}
