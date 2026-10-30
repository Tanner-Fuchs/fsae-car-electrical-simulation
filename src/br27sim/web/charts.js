/* Chart.js helpers: theme-aware colors, reference lines, phase bands. */
(function (root) {
  'use strict';
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const charts = new Map();

  const refLinePlugin = {
    id: 'refLines',
    afterDraw(chart, _args, opts) {
      const lines = (opts && opts.lines) || [];
      const vlines = (opts && opts.vlines) || [];
      if (!lines.length && !vlines.length) return;
      const { ctx, chartArea: a, scales } = chart;
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.25;
      ctx.font = '11px ' + css('--f-body');
      for (const l of lines) {
        const y = scales.y.getPixelForValue(l.y);
        if (y < a.top || y > a.bottom) continue;
        ctx.strokeStyle = l.color || css('--ink-3');
        ctx.beginPath(); ctx.moveTo(a.left, y); ctx.lineTo(a.right, y); ctx.stroke();
        if (l.label) { ctx.fillStyle = css('--ink-2'); ctx.textAlign = 'right'; ctx.fillText(l.label, a.right - 4, y - 4); }
      }
      for (const l of vlines) {
        const x = scales.x.getPixelForValue(l.x);
        if (x < a.left || x > a.right) continue;
        ctx.strokeStyle = l.color || css('--ink-3');
        ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke();
        if (l.label) { ctx.fillStyle = css('--ink-2'); ctx.textAlign = 'left'; ctx.fillText(l.label, x + 4, a.top + 12); }
      }
      ctx.restore();
    }
  };

  const bandPlugin = {
    id: 'bands',
    beforeDatasetsDraw(chart, _args, opts) {
      const bands = (opts && opts.bands) || [];
      if (!bands.length) return;
      const { ctx, chartArea: a, scales } = chart;
      ctx.save();
      ctx.font = '10.5px ' + css('--f-body');
      bands.forEach((b, i) => {
        const x0 = Math.max(a.left, scales.x.getPixelForValue(b.x0));
        const x1 = Math.min(a.right, scales.x.getPixelForValue(b.x1));
        if (x1 <= x0) return;
        ctx.fillStyle = b.color ? b.color : (i % 2 ? 'transparent' : css('--grid'));
        ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
        if (x1 - x0 > 46 && b.label) {
          ctx.fillStyle = css('--ink-3');
          ctx.textAlign = 'left';
          ctx.fillText(b.label, x0 + 4, a.top + 11);
        }
      });
      ctx.restore();
    }
  };

  function baseOptions(o) {
    const ink2 = css('--ink-2'), grid = css('--grid');
    return {
      responsive: true, maintainAspectRatio: false, animation: false, normalized: true,
      interaction: { mode: o.bar ? 'nearest' : 'index', intersect: !!o.bar, axis: 'x' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: css('--panel'), titleColor: css('--ink'), bodyColor: css('--ink'),
          borderColor: css('--rule'), borderWidth: 1, padding: 8, boxPadding: 4,
          titleFont: { family: css('--f-body') }, bodyFont: { family: css('--f-mono') },
          callbacks: o.tooltip || {}
        },
        refLines: { lines: o.refs || [], vlines: o.vrefs || [] },
        bands: { bands: o.bands || [] },
        decimation: { enabled: false }
      },
      scales: {
        x: {
          type: o.bar ? 'category' : 'linear', min: o.xMin, max: o.xMax,
          title: { display: !!o.xTitle, text: o.xTitle, color: ink2, font: { size: 11.5 } },
          grid: { color: grid, display: !o.bar }, border: { color: css('--rule') },
          ticks: { color: ink2, maxRotation: 0, autoSkipPadding: 14, font: { size: 11 } }
        },
        y: {
          min: o.yMin, max: o.yMax, suggestedMin: o.ySugMin, suggestedMax: o.ySugMax,
          title: { display: !!o.yTitle, text: o.yTitle, color: ink2, font: { size: 11.5 } },
          grid: { color: grid }, border: { display: false },
          ticks: { color: ink2, font: { size: 11 }, maxTicksLimit: 6 }
        }
      }
    };
  }

  // datasets: [{label, data:[{x,y}] or numbers, color:'--s1', fill, points, stepped, dash}]
  function draw(id, datasets, o) {
    o = o || {};
    const canvas = document.getElementById(id);
    if (!canvas || !window.Chart) return;
    const ds = datasets.map(d => {
      const c = css(d.color || '--s1');
      return o.bar ? {
        label: d.label, data: d.data, backgroundColor: d.colors ? d.colors.map(css) : c,
        borderRadius: 4, borderSkipped: 'start', maxBarThickness: 46, borderColor: css('--panel'), borderWidth: 2
      } : {
        label: d.label, data: d.data, borderColor: c, backgroundColor: c + '22',
        borderWidth: d.width || 2, pointRadius: d.points ? 3 : 0, pointHoverRadius: 4,
        pointBackgroundColor: c, pointBorderColor: css('--panel'), pointBorderWidth: d.points ? 1.5 : 0,
        fill: d.fill ? 'origin' : false, stepped: d.stepped || false, tension: 0, spanGaps: false,
        borderDash: d.dash || [], showLine: d.showLine !== false
      };
    });
    const old = charts.get(id);
    if (old) {
      old.data.datasets = ds;
      if (o.labels) old.data.labels = o.labels;
      old.options = baseOptions(o);
      old.update('none');
      return old;
    }
    const ch = new Chart(canvas, {
      type: o.bar ? 'bar' : 'line',
      data: { labels: o.labels, datasets: ds },
      options: baseOptions(o),
      plugins: [refLinePlugin, bandPlugin]
    });
    charts.set(id, ch);
    return ch;
  }

  function resetAll() { for (const c of charts.values()) c.destroy(); charts.clear(); }
  function legend(elId, items) {
    const el = document.getElementById(elId);
    if (el) el.innerHTML = items.map(([label, color, dash]) =>
      `<span><i style="background:${dash ? 'transparent' : `var(${color})`};${dash ? `border-top:2px dashed var(${color});height:0` : ''}"></i>${label}</span>`).join('');
  }

  root.BRCharts = { draw, resetAll, css, legend };
})(window);
