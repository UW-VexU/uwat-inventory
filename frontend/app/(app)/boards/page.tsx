'use client';

import type { BoardSummary } from '@uwat/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { api, ApiFailure, errorMessage } from '@/lib/api';
import { readGerberFiles, type GerberText } from '@/lib/gerberFiles';
import { useInventory } from '@/lib/inventory';

const folderProps = { webkitdirectory: '', directory: '' } as Record<string, string>;

interface Duplicate {
  message: string;
  files: GerberText[];
}

export default function BoardsPage() {
  const router = useRouter();
  const { liveVersion } = useInventory();
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setBoards((await api<{ boards: BoardSummary[] }>('/api/boards')).boards);
    } catch (error) {
      setProblem(errorMessage(error));
    }
  }, []);

  // Again whenever stock changes, since that moves each board's count.
  useEffect(() => {
    void load();
  }, [load, liveVersion]);

  const send = async (files: GerberText[], replace = false) => {
    setBusy(true);
    setProblem(null);
    setDuplicate(null);
    try {
      const { board } = await api<{ board: BoardSummary }>('/api/boards', {
        method: 'POST',
        body: { files, replace },
      });
      router.push(`/boards/${board.id}`);
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'board_exists') {
        setDuplicate({ message: error.message, files });
      } else {
        setProblem(errorMessage(error));
      }
      setBusy(false);
    }
  };

  const take = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setProblem(null);
    try {
      const files = await readGerberFiles([...list]);
      if (files.length === 0) {
        setProblem("There aren't any gerber files in that selection.");
        return;
      }
      await send(files);
    } catch (error) {
      setProblem(errorMessage(error));
    }
  };

  // Uploading is rare, so it lives in the header. Drop anywhere on the page.
  const showDropzone = dragging || busy || boards?.length === 0;

  return (
    <div
      className="page"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void take(event.dataTransfer.files);
      }}
    >
      <header className="page-head">
        <h1>Boards</h1>
        <div className="page-actions">
          <button type="button" className="button" disabled={busy} onClick={() => folderInput.current?.click()}>
            Upload folder
          </button>
          <button type="button" className="button button-primary" disabled={busy} onClick={() => fileInput.current?.click()}>
            <Icon name="upload" />
            Upload gerbers
          </button>
        </div>
      </header>

      {showDropzone ? (
        <section className={`dropzone ${dragging ? 'is-dragging' : ''}`}>
          <p>{busy ? 'Reading the board…' : 'Drop gerbers here, loose or zipped'}</p>
        </section>
      ) : null}
      <input
        ref={fileInput}
        type="file"
        multiple
        className="sr-only"
        aria-label="Choose gerber files or a zip"
        onChange={(event) => void take(event.target.files)}
      />
      <input
        ref={folderInput}
        type="file"
        className="sr-only"
        aria-label="Choose a gerber folder"
        onChange={(event) => void take(event.target.files)}
        {...folderProps}
      />

      {problem ? <p className="form-error" role="alert">{problem}</p> : null}

      {duplicate ? (
        <div className="bag-confirm board-replace">
          <p>{duplicate.message} Replace it? Links stay on any spots that still exist.</p>
          <div>
            <button type="button" className="button button-danger" disabled={busy} onClick={() => void send(duplicate.files, true)}>
              Replace board
            </button>
            <button type="button" className="button" onClick={() => setDuplicate(null)}>
              Keep the old one
            </button>
          </div>
        </div>
      ) : null}

      {boards && boards.length > 0 ? (
        <ul className="board-grid">
          {boards.map((board) => (
            <li key={board.id}>
              <Link href={`/boards/${board.id}`} className="board-card">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/boards/${board.id}/top.svg`} alt="" />
                <span className="board-card-name">
                  {board.name}
                  {board.revision ? <small> rev {board.revision}</small> : null}
                </span>
                <span className="muted">
                  {board.placedCount} of {board.lineCount} parts on the board · {board.stockedCount} in stock
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
