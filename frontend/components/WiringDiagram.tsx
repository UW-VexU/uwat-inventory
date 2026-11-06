import { connectionsOf, friendlyNet, isRail, refKind, type PlacementGeometry } from '@uwat/shared';

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

function listed(others: readonly string[]): string {
  const shown = others.slice(0, MAX_LISTED).join(', ');
  return others.length > MAX_LISTED ? `${shown} +${others.length - MAX_LISTED} more` : shown;
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
  if (pins.length === 2 && first && second) {
    // Power rails reach half the board, so only signals are worth listing here.
    const signals = pins.filter((pad) => pad.net && !isRail(pad.net));
    return (
      <div className="wiring">
        <div className="wire" aria-label={`${placement.ref} connects ${friendlyNet(first.net)} to ${friendlyNet(second.net)}`}>
          <span className="wire-net">{friendlyNet(first.net)}</span>
          <span className="wire-line" />
          <Symbol kind={refKind(placement.ref)} />
          <span className="wire-line" />
          <span className="wire-net">{friendlyNet(second.net)}</span>
        </div>
        {signals.map((pad) => {
          const others = connectionsOf(pad.net, placement.ref, all);
          return others.length > 0 ? (
            <p key={pad.pin} className="wire-others">
              {friendlyNet(pad.net)} goes to {listed(others)}
            </p>
          ) : null;
        })}
      </div>
    );
  }

  return (
    <div className="wiring pin-scroll">
      <table className="pins">
        <thead>
          <tr>
            <th scope="col">Pin</th>
            <th scope="col">Connects to</th>
          </tr>
        </thead>
        <tbody>
          {pins.map((pad) => {
            const others = pad.net && !isRail(pad.net) ? connectionsOf(pad.net, placement.ref, all) : [];
            return (
              <tr key={`${pad.pin}-${pad.net}`}>
                <th scope="row">{pad.pin}</th>
                <td>
                  <span className="pin-net">{friendlyNet(pad.net)}</span>
                  {others.length > 0 ? <span className="pin-others">{listed(others)}</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
