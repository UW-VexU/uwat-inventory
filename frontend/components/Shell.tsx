'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { api } from '@/lib/api';
import { useInventory } from '@/lib/inventory';
import { Icon, type IconName } from './Icon';

const NAV: ReadonlyArray<{ href: string; label: string; icon: IconName }> = [
  { href: '/', label: 'Inventory', icon: 'parts' },
  { href: '/boxes', label: 'Boxes', icon: 'box' },
  { href: '/activity', label: 'Activity', icon: 'activity' },
  { href: '/import', label: 'Import', icon: 'upload' },
];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user } = useInventory();

  const signOut = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    window.location.assign('/login');
  };

  return (
    <div className="shell">
      <aside className="rail">
        <Link href="/" className="rail-brand" aria-label="UWAT inventory home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/uwat-logo-white.svg" alt="UWAT" width={124} height={29} />
          <span className="rail-team">VEXU Competitive Robotics</span>
        </Link>

        <nav className="rail-nav" aria-label="Main">
          {NAV.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className="rail-link" aria-current={active ? 'page' : undefined}>
                <Icon name={item.icon} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="rail-foot">
          {user ? (
            <div className="rail-user">
              <span className="rail-user-name" title={user.login}>
                {user.name ?? user.login}
              </span>
              <button type="button" className="icon-button" aria-label="Sign out" title="Sign out" onClick={signOut}>
                <Icon name="logout" />
              </button>
            </div>
          ) : null}
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
