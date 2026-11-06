import type { BoardDetail } from '@uwat/shared';

/**
 * The board is drawn in a web view: the gerber drawings are too heavy for native SVG,
 * and this gives pinch zoom on both platforms for free.
 */
export function boardHtml(detail: BoardDetail, topSvg: string, bottomSvg: string): string {
  const { widthMm: width, heightMm: height } = detail.board;
  const spots = detail.placements.map(({ ref, side, x, y, pads, dnp }) => ({ ref, side, x, y, pads, dnp }));

  return `<!doctype html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=12,user-scalable=yes">
<style>
  html, body { margin: 0; height: 100%; background: #0b0b0b; }
  body { display: flex; align-items: center; justify-content: center; }
  #board { position: relative; width: min(100vw, calc(100vh * ${width / height})); aspect-ratio: ${width} / ${height}; background: #101010; }
  .drawing, .drawing svg, #marks { position: absolute; inset: 0; width: 100%; height: 100%; }
  .drawing { display: none; transition: opacity 140ms; }
  .drawing.on { display: block; }
  .dim .drawing { opacity: 0.32; }
  text { font: italic 700 1.15px sans-serif; paint-order: stroke; stroke: #0b0b0b; stroke-width: 0.3px; }
</style>
</head><body>
<div id="board">
  <div class="drawing" id="top">${topSvg}</div>
  <div class="drawing" id="bottom">${bottomSvg}</div>
  <svg id="marks" viewBox="0 0 ${width} ${height}"></svg>
</div>
<script>
  var spots = ${JSON.stringify(spots)};
  var width = ${width};
  var NS = 'http://www.w3.org/2000/svg';

  function shape(tag, attributes) {
    var node = document.createElementNS(NS, tag);
    for (var key in attributes) node.setAttribute(key, attributes[key]);
    return node;
  }

  window.show = function (state) {
    document.getElementById('top').className = 'drawing' + (state.side === 'top' ? ' on' : '');
    document.getElementById('bottom').className = 'drawing' + (state.side === 'bottom' ? ' on' : '');
    document.getElementById('board').className = state.lit.length ? 'dim' : '';

    var marks = document.getElementById('marks');
    while (marks.firstChild) marks.removeChild(marks.firstChild);
    var flip = function (x) { return state.side === 'bottom' ? width - x : x; };
    var colour = state.warning ? '#ffffff' : '#e0a300';

    spots.filter(function (spot) { return spot.side === state.side; }).forEach(function (spot) {
      var lit = state.lit.indexOf(spot.ref) !== -1;
      var done = state.done.indexOf(spot.ref) !== -1;
      if (!lit && !done) return;
      spot.pads.forEach(function (pad) {
        marks.appendChild(shape('rect', {
          x: flip(pad.x) - pad.w / 2, y: pad.y - pad.h / 2, width: pad.w, height: pad.h, rx: 0.1,
          fill: lit ? colour : '#6e5300',
        }));
      });
      if (lit) {
        var top = Math.min.apply(null, spot.pads.map(function (pad) { return pad.y - pad.h / 2; }));
        var label = shape('text', { x: flip(spot.x), y: Math.max(top - 0.35, 1.2), fill: colour, 'text-anchor': 'middle' });
        label.textContent = spot.ref;
        marks.appendChild(label);
      }
    });
  };
  window.ReactNativeWebView && window.ReactNativeWebView.postMessage('ready');
</script>
</body></html>`;
}
