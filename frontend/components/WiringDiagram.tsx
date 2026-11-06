import {
  connectionsOf,
  friendlyNet,
  refKind,
  type PlacementGeometry,
} from '@uwat/shared';

const MAX_LISTED = 5;

function Symbol({ kind }: { kind: string }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 2 };
  return (
    <svg className="wire-symbol" viewBox="0 0 48 24" aria-hidden="true">
      {kind === 'R' ? <rect x="4" y="7" width="40" height="10" {...common} /> : null}
      {kind === 'C' ? (
        <>
          <path d="M0 12h20M28 12h20" {...common} />
          <path d="M20 3v18M28 3v18" {...common} />
        </>
      ) : null}
      {kind === 'L' ? <path d="M2 14a5 5 0 0 1 11 0a5 5 0 0 1 11 0a5 5 0 0 1 11 0a5 5 0 0 1 11 0" {...common} /> : null}
      {kind === 'D' ? (
        <>
          <path d="M0 12h48" {...common} />
          <path d="M16 4v16l15-8Z" fill="currentColor" />
          <path d="M32 4v16" {...common} />
        </>
      ) : null}
      {kind === 'F' ? (
        <>
          <rect x="6" y="7" width="36" height="10" {...common} />
          <path d="M0 12h48" {...common} />
        </>
      ) : null}
      {!['R', 'C', 'L', 'D', 'F'].includes(kind) ? <rect x="10" y="4" width="28" height="16" {...common} /> : null}
    </svg>
  );
}

function PinRow({ pin, net, others }: { pin: string; net: string | null; others: string[] }) {
  const listed = others.slice(0, MAX_LISTED);
  const extra = others.length - listed.length;
  return (
    <tr>
      <th scope="row">{pin}</th>
      <td>
        <span className="pin-net">{friendlyNet(net)}</span>
        {listed.length > 0 ? (
          <span className="pin-others">
            {listed.join(', ')}
            {extra > 0 ? ` +${extra} more` : ''}
          </span>
        ) : null}
      </td>
    </tr>
  );
}

/** A small stand-in for the schematic, drawn from the nets in the gerbers. */
export function WiringDiagram({ placement, all }: { placement: PlacementGeometry; all: readonly PlacementGeometry[] }) {
  const seen = new Set<string>();
  const pins = placement.pads.filter((pad) => {
    const key = `${pad.pin}|${pad.net}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const [first, second] = pins;
  const twoPin = pins.length === 2 && first && second;

  return (
    <div className="wiring">
      {twoPin ? (
        <div className="wire" aria-label={`${placement.ref} connects ${friendlyNet(first.net)} to ${friendlyNet(second.net)}`}>
          <span className="wire-net">{friendlyNet(first.net)}</span>
          <span className="wire-line" />
          <Symbol kind={refKind(placement.ref)} />
          <span className="wire-line" />
          <span className="wire-net">{friendlyNet(second.net)}</span>
        </div>
      ) : null}
      <div className={pins.length > 8 ? 'pin-scroll' : undefined}>
        <table className="pins">
          <thead>
            <tr>
              <th scope="col">Pin</th>
              <th scope="col">Connects to</th>
            </tr>
          </thead>
          <tbody>
            {pins.map((pad) => (
              <PinRow
                key={`${pad.pin}-${pad.net}`}
                pin={pad.pin}
                net={pad.net}
                others={connectionsOf(pad.net, placement.ref, all)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
