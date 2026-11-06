'use client';

import {
  layoutLabels,
  spotBox,
  type BoardSide,
  type LabelRequest,
  type PlacementView,
  type SpotBox,
} from '@uwat/shared';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Icon } from './Icon';

/** Pixels per mm, and where the board's top-left corner sits on screen. */
interface Camera {
  scale: number;
  x: number;
  y: number;
}

export interface BoardCanvasHandle {
  /** Flies to these spots, or back to the whole board if none are given. */
  focus: (refs: readonly string[]) => void;
}

interface Props {
  boardId: string;
  widthMm: number;
  heightMm: number;
  side: BoardSide;
  placements: readonly PlacementView[];
  /** Spots to light up. When there are any, everything else fades back. */
  matched: ReadonlySet<string>;
  /** Spots whose part has already been found. */
  done: ReadonlySet<string>;
  /** The lit spots are a warning, not somewhere a part goes. */
  warning?: boolean;
  selected: string | null;
  /** The label text for a spot at a given level of zoom. */
  labelLines: (spot: PlacementView, detail: number) => string[];
  /** The short answer shown on hover. */
  summary: (spot: PlacementView) => string;
  onSelect: (ref: string | null) => void;
  /** Space kept clear for what sits on top of the board. */
  insets: { top: number; right: number; bottom: number; left: number };
}

const MAX_ZOOM = 16;
const MIN_ZOOM = 0.7;
const DETAIL_ONE = 1.9;
const DETAIL_TWO = 3.6;
const FLY_MS = 240;
const DRAG_THRESHOLD_PX = 4;
const FOCUS_PADDING_MM = 3;
const SINGLE_SPOT_MM = 14;
const MAX_PADS_UNCOVERED = 3;

function ease(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

export const BoardCanvas = forwardRef<BoardCanvasHandle, Props>(function BoardCanvas(
  { boardId, widthMm, heightMm, side, placements, matched, done, warning, selected, labelLines, summary, onSelect, insets },
  handle,
) {
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [camera, setCamera] = useState<Camera | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const cameraRef = useRef<Camera | null>(null);
  const flight = useRef(0);
  const touched = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ moved: false, ref: null as string | null, startX: 0, startY: 0, pinch: 0 });

  const show = useCallback((next: Camera) => {
    cameraRef.current = next;
    setCamera(next);
  }, []);

  const frame = useCallback(
    (box: SpotBox, padding: number): Camera => {
      const roomX = Math.max(size.width - insets.left - insets.right, 80);
      const roomY = Math.max(size.height - insets.top - insets.bottom, 80);
      const boxWidth = box.right - box.left + padding * 2;
      const boxHeight = box.bottom - box.top + padding * 2;
      const scale = Math.min(roomX / boxWidth, roomY / boxHeight);
      return {
        scale,
        x: insets.left + roomX / 2 - ((box.left + box.right) / 2) * scale,
        y: insets.top + roomY / 2 - ((box.top + box.bottom) / 2) * scale,
      };
    },
    [insets, size],
  );

  const whole = useMemo<SpotBox>(() => ({ left: 0, right: widthMm, top: 0, bottom: heightMm }), [widthMm, heightMm]);
  const fitScale = size.width > 0 ? frame(whole, 0).scale : 1;

  const fly = useCallback(
    (target: Camera) => {
      const start = cameraRef.current;
      flight.current += 1;
      const id = flight.current;
      if (!start || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        show(target);
        return;
      }
      const began = performance.now();
      const step = (now: number) => {
        if (id !== flight.current) return;
        const t = Math.min((now - began) / FLY_MS, 1);
        const k = ease(t);
        show({
          scale: start.scale + (target.scale - start.scale) * k,
          x: start.x + (target.x - start.x) * k,
          y: start.y + (target.y - start.y) * k,
        });
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    [show],
  );

  useImperativeHandle(
    handle,
    () => ({
      focus(refs) {
        const boxes = placements
          .filter((placement) => refs.includes(placement.ref) && placement.side === side)
          .map((placement) => spotBox(placement, widthMm, side));
        touched.current = true;
        if (boxes.length === 0) {
          touched.current = false;
          fly(frame(whole, 0));
          return;
        }
        const area: SpotBox = {
          left: Math.min(...boxes.map((box) => box.left)),
          right: Math.max(...boxes.map((box) => box.right)),
          top: Math.min(...boxes.map((box) => box.top)),
          bottom: Math.max(...boxes.map((box) => box.bottom)),
        };
        const centreX = (area.left + area.right) / 2;
        const centreY = (area.top + area.bottom) / 2;
        const half = SINGLE_SPOT_MM / 2;
        // A single small part shouldn't fill the screen: you still need to see what's around it.
        const framed: SpotBox = {
          left: Math.min(area.left, centreX - half),
          right: Math.max(area.right, centreX + half),
          top: Math.min(area.top, centreY - half),
          bottom: Math.max(area.bottom, centreY + half),
        };
        fly(frame(framed, FOCUS_PADDING_MM));
      },
    }),
    [fly, frame, placements, side, whole, widthMm],
  );

  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (size.width > 0 && (!cameraRef.current || !touched.current)) show(frame(whole, 0));
  }, [frame, show, size, whole]);

  // The bottom drawing is mirrored, so wherever you were on the top means nothing here.
  const lastSide = useRef(side);
  useEffect(() => {
    if (lastSide.current === side) return;
    lastSide.current = side;
    touched.current = false;
    flight.current += 1;
    setHovered(null);
    show(frame(whole, 0));
  }, [frame, show, side, whole]);

  const zoomAt = useCallback(
    (factor: number, atX: number, atY: number) => {
      const current = cameraRef.current;
      if (!current) return;
      flight.current += 1;
      touched.current = true;
      const scale = Math.min(Math.max(current.scale * factor, fitScale * MIN_ZOOM), fitScale * MAX_ZOOM);
      const applied = scale / current.scale;
      show({ scale, x: atX - (atX - current.x) * applied, y: atY - (atY - current.y) * applied });
    },
    [fitScale, show],
  );

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const speed = event.ctrlKey ? 0.012 : 0.0022;
      zoomAt(Math.exp(-event.deltaY * speed), event.clientX - rect.left, event.clientY - rect.top);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const refAt = (target: EventTarget | null) =>
    target instanceof Element ? (target.closest('[data-ref]')?.getAttribute('data-ref') ?? null) : null;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    gesture.current = {
      moved: false,
      ref: refAt(event.target),
      startX: event.clientX,
      startY: event.clientY,
      pinch: 0,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const last = pointers.current.get(event.pointerId);
    if (!last) {
      setHovered(refAt(event.target));
      return;
    }
    const element = stage.current;
    const current = cameraRef.current;
    if (!element || !current) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = element.getBoundingClientRect();
      if (gesture.current.pinch > 0) {
        zoomAt(distance / gesture.current.pinch, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
      }
      gesture.current.pinch = distance;
      gesture.current.moved = true;
      return;
    }

    const far = Math.hypot(event.clientX - gesture.current.startX, event.clientY - gesture.current.startY);
    if (!gesture.current.moved && far < DRAG_THRESHOLD_PX) return;
    if (!gesture.current.moved) {
      gesture.current.moved = true;
      setDragging(true);
      setHovered(null);
      element.setPointerCapture(event.pointerId);
      flight.current += 1;
      touched.current = true;
    }
    show({ ...current, x: current.x + event.clientX - last.x, y: current.y + event.clientY - last.y });
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const wasTap = pointers.current.size === 1 && !gesture.current.moved;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) setDragging(false);
    if (wasTap && event.type === 'pointerup') onSelect(gesture.current.ref);
  };

  const zoomButton = (factor: number) => zoomAt(factor, size.width / 2, size.height / 2);

  const visible = useMemo(() => placements.filter((placement) => placement.side === side), [placements, side]);
  const filtering = matched.size > 0;
  const scale = camera?.scale ?? 1;
  const zoom = scale / fitScale;
  const detail = zoom >= DETAIL_TWO ? 2 : zoom >= DETAIL_ONE ? 1 : 0;

  const labels = useMemo(() => {
    const requests: LabelRequest[] = visible
      .filter((spot) => !filtering || matched.has(spot.ref))
      .map((spot) => ({
        ref: spot.ref,
        lines: labelLines(spot, detail),
        box: spotBox(spot, widthMm, side),
        priority: spot.ref === selected ? 2 : 0,
        canCover: spot.pads.length > MAX_PADS_UNCOVERED,
      }));
    return layoutLabels(requests, scale, { widthMm, heightMm });
  }, [detail, filtering, heightMm, labelLines, matched, scale, selected, side, visible, widthMm]);

  const hiddenLabels = (filtering ? visible.filter((spot) => matched.has(spot.ref)).length : visible.length) - labels.length;
  const flip = (x: number) => (side === 'bottom' ? widthMm - x : x);
  const hoverSpot = hovered && !dragging ? visible.find((spot) => spot.ref === hovered) : undefined;

  const viewBox = camera
    ? `${-camera.x / scale} ${-camera.y / scale} ${size.width / scale} ${size.height / scale}`
    : `0 0 ${widthMm} ${heightMm}`;

  return (
    <div
      ref={stage}
      className={`canvas ${dragging ? 'is-dragging' : ''} ${filtering ? 'is-filtering' : ''} ${warning ? 'is-warning' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onPointerLeave={() => setHovered(null)}
      onDoubleClick={(event) => {
        const rect = stage.current?.getBoundingClientRect();
        if (rect) zoomAt(1.8, event.clientX - rect.left, event.clientY - rect.top);
      }}
    >
      <svg viewBox={viewBox} preserveAspectRatio="none" aria-hidden="true">
        <rect className="canvas-backing" width={widthMm} height={heightMm} rx={0.8} />
        <image
          className="canvas-board"
          href={`/api/boards/${boardId}/${side}.svg`}
          x={0}
          y={0}
          width={widthMm}
          height={heightMm}
          preserveAspectRatio="none"
        />
        {visible.map((spot) => {
          const box = spotBox(spot, widthMm, side);
          const lit = matched.has(spot.ref) || spot.ref === selected;
          const finished = done.has(spot.ref);
          const firstPad = spot.pads.find((pad) => pad.pin === '1' || pad.pin === 'A1');
          return (
            <g key={spot.ref} data-ref={spot.ref} className={lit ? 'spot spot-lit' : 'spot'}>
              {lit || finished
                ? spot.pads.map((pad, index) => (
                    <rect
                      key={`${pad.pin}-${index}`}
                      className={lit ? 'spot-pad' : 'spot-pad-done'}
                      x={flip(pad.x) - pad.w / 2}
                      y={pad.y - pad.h / 2}
                      width={pad.w}
                      height={pad.h}
                      rx={0.1}
                    />
                  ))
                : null}
              {spot.ref === selected && firstPad && spot.pads.length > 1 ? (
                <circle className="spot-pin" cx={flip(firstPad.x)} cy={firstPad.y} r={0.24} />
              ) : null}
              <rect
                className="spot-hit"
                x={box.left - 0.3}
                y={box.top - 0.3}
                width={box.right - box.left + 0.6}
                height={box.bottom - box.top + 0.6}
              />
            </g>
          );
        })}
      </svg>

      {camera
        ? labels.map((label) => {
            const [title, ...rest] = label.lines;
            const hit = matched.has(label.ref) || label.ref === selected;
            const empty = visible.find((spot) => spot.ref === label.ref)?.dnp;
            return (
              <button
                key={label.ref}
                type="button"
                data-ref={label.ref}
                className={`spot-label ${hit ? 'is-hit' : ''} ${label.ref === selected ? 'is-selected' : ''} ${done.has(label.ref) ? 'is-done' : ''} ${empty ? 'is-empty' : ''}`}
                style={{ transform: `translate(${label.x * scale + camera.x}px, ${label.y * scale + camera.y}px)` }}
                tabIndex={-1}
              >
                <strong>{title}</strong>
                {rest.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </button>
            );
          })
        : null}

      {hoverSpot && camera ? (
        <div
          className="spot-tip"
          style={{
            transform: `translate(${flip(hoverSpot.x) * scale + camera.x}px, ${spotBox(hoverSpot, widthMm, side).bottom * scale + camera.y + 8}px) translateX(-50%)`,
          }}
        >
          <strong>{hoverSpot.ref}</strong> {summary(hoverSpot)}
        </div>
      ) : null}

      <div className="canvas-tools" onPointerDown={(event) => event.stopPropagation()}>
        {hiddenLabels > 0 ? <span className="canvas-hint">Zoom in for {hiddenLabels} more labels</span> : null}
        <div className="zoom">
          <button type="button" aria-label="Zoom out" onClick={() => zoomButton(1 / 1.5)}>
            <Icon name="minus" />
          </button>
          <button
            type="button"
            className="zoom-fit"
            onClick={() => {
              touched.current = false;
              fly(frame(whole, 0));
            }}
          >
            Fit
          </button>
          <button type="button" aria-label="Zoom in" onClick={() => zoomButton(1.5)}>
            <Icon name="plus" />
          </button>
        </div>
      </div>
    </div>
  );
});
