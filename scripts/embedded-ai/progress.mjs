function truncateText(value, maxLength = 72) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function formatPercent(done, total) {
  if (!total) return '100.0%';
  return `${((done / total) * 100).toFixed(1)}%`;
}

export function createClassificationProgress(total, options = {}) {
  const stream = options.stream ?? process.stderr;
  const reusedCount = options.reusedCount ?? 0;
  const totalCount = options.totalCount ?? total;
  const providerCounts = {
    tencent_tokenhub: 0,
    heuristic: 0,
    heuristic_fallback: 0,
  };

  const startedAt = Date.now();
  let completed = 0;
  let inFlight = 0;
  let failed = 0;
  let lastTitle = '';
  let lastProvider = '';
  let lastRenderAt = 0;
  let lastLineLength = 0;

  function render(force = false) {
    const now = Date.now();
    if (!force && now - lastRenderAt < 100) {
      return;
    }
    lastRenderAt = now;

    const elapsedMs = now - startedAt;
    const avgMsPerPaper = completed > 0 ? elapsedMs / completed : 0;
    const remainingMs =
      total > completed && avgMsPerPaper > 0
        ? avgMsPerPaper * (total - completed)
        : 0;

    const line =
      `[classify] ${reusedCount}/${totalCount} reused, ${completed}/${total} new (${formatPercent(completed, total)})` +
      ` | failed ${failed}` +
      ` | in-flight ${inFlight}` +
      ` | provider tencent=${providerCounts.tencent_tokenhub}` +
      ` heuristic=${providerCounts.heuristic}` +
      ` fallback=${providerCounts.heuristic_fallback}` +
      ` | elapsed ${formatDuration(elapsedMs)}` +
      ` | eta ${formatDuration(remainingMs)}` +
      ` | ${truncateText(lastTitle, 80)}` +
      (lastProvider ? ` | last=${lastProvider}` : '');

    const padding =
      lastLineLength > line.length ? ' '.repeat(lastLineLength - line.length) : '';

    stream.write(`\r${line}${padding}`);
    lastLineLength = line.length;
  }

  function logStep(message) {
    stream.write(`\n${message}\n`);
  }

  return {
    onStart(index, paper) {
      inFlight += 1;
      lastTitle = `#${index + 1} ${paper?.title ?? ''}`;
      render();
    },

    onSuccess(index, paper, classified) {
      inFlight = Math.max(0, inFlight - 1);
      completed += 1;

      const provider = String(classified?.provider_used ?? '').trim();
      if (providerCounts[provider] != null) {
        providerCounts[provider] += 1;
      }

      lastTitle = `#${index + 1} ${paper?.title ?? ''}`;
      lastProvider = provider;
      render();

      logStep(`[classify] done ${index + 1}/${total}: ${truncateText(paper?.title, 120)}`);
    },

    onError(index, paper, error) {
      inFlight = Math.max(0, inFlight - 1);
      failed += 1;
      stream.write(
        `\n[classify] error ${index + 1}/${total}: ${truncateText(
          paper?.title,
          120,
        )} | ${truncateText(error?.message ?? error, 160)}\n`,
      );
      render(true);
    },

    finish(finalStats = null) {
      render(true);
      stream.write('\n');

      const summary = finalStats?.by_provider ?? providerCounts;
      const totalClassified = finalStats?.total ?? completed;

      stream.write(
        `[classify] summary: total=${totalClassified} | reused=${reusedCount} | new=${completed} | failed=${failed}` +
          ` | tencent_tokenhub=${summary.tencent_tokenhub ?? 0}` +
          ` | heuristic=${summary.heuristic ?? 0}` +
          ` | heuristic_fallback=${summary.heuristic_fallback ?? 0}\n`,
      );
    },
  };
}