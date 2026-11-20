'use client';

import type { PartSummary, StockEventView } from '@uwat/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { describeEvent } from '@/components/eventText';
import { useToast } from '@/components/Toast';
import { api, errorMessage } from '@/lib/api';
import { formatNumber, timeAgo } from '@/lib/format';
import { useInventory } from '@/lib/inventory';

interface Page {
  events: StockEventView[];
  nextCursor: string | null;
}

function dayHeading(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' });
}

function groupByDay(events: StockEventView[]) {
  const groups = new Map<string, StockEventView[]>();
  for (const event of events) {
    const heading = dayHeading(event.createdAt);
    groups.set(heading, [...(groups.get(heading) ?? []), event]);
  }
  return [...groups];
}

export default function ActivityPage() {
  const { applyPart, liveVersion } = useInventory();
  const toast = useToast();
  const [events, setEvents] = useState<StockEventView[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async (before?: string) => {
    try {
      const page = await api<Page>(`/api/events?limit=60${before ? `&before=${before}` : ''}`);
      setEvents((current) => (before && current ? [...current, ...page.events] : page.events));
      setCursor(page.nextCursor);
    } catch (error) {
      setProblem(errorMessage(error));
    }
  }, []);

  // Reloads when anyone changes stock, so a phone scan shows up here too.
  useEffect(() => {
    void load();
  }, [load, liveVersion]);

  const undo = async (eventId: string) => {
    try {
      const result = await api<{ part: PartSummary }>(`/api/events/${eventId}/undo`, { method: 'POST' });
      applyPart(result.part);
      toast('Undone.');
      await load();
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    }
  };

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <h1>Activity</h1>
        <div className="page-actions">
          <a className="button" href="/api/export.csv">
            Export inventory CSV
          </a>
        </div>
      </header>

      {problem ? <p className="form-error">{problem}</p> : null}
      {events === null && !problem ? <p className="muted">Loading activity…</p> : null}
      {events?.length === 0 ? (
        <div className="empty">
          <h2>Nothing yet</h2>
          <p>Changes show up here as people take and add stock.</p>
        </div>
      ) : null}

      {groupByDay(events ?? []).map(([heading, group]) => (
        <section key={heading} className="day">
          <h2>{heading}</h2>
          <ol className="feed">
            {group.map((event) => (
              <li key={event.id} className={event.undone ? 'is-undone' : undefined}>
                <span className={`feed-delta ${event.delta < 0 ? 'is-down' : ''}`}>
                  {event.delta === 0 ? '·' : `${event.delta > 0 ? '+' : '−'}${formatNumber(Math.abs(event.delta))}`}
                </span>
                <div className="feed-text">
                  <p>{describeEvent(event)}</p>
                  <Link href={`/?part=${event.part.id}`} className="feed-part">
                    {event.part.description}
                  </Link>
                  {event.note ? <p className="faint">{event.note}</p> : null}
                </div>
                <div className="feed-side">
                  <time dateTime={event.createdAt} title={new Date(event.createdAt).toLocaleString('en-CA')}>
                    {timeAgo(event.createdAt)}
                  </time>
                  {event.canUndo ? (
                    <button type="button" className="link-button" onClick={() => void undo(event.id)}>
                      Undo
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}

      {cursor ? (
        <button type="button" className="button" onClick={() => void load(cursor)}>
          Load older
        </button>
      ) : null}
    </div>
  );
}
