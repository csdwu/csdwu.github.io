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
  const providerCounts = {
    tencent_tokenhub: 0,
    heuristic: 0,
    heuristic_fallback: 0,
  };

  const startedAt = Date.now();
  let completed = 0;
  let inFlight = 0;
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
      `[embedded-ai] Classifying: ${completed}/${total} (${formatPercent(completed, total)})` +
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

  function logFallback(index, paper, errorMessage) {
    stream.write(
      `\n[embedded-ai] Fallback #${index + 1}: ${truncateText(
        paper?.title,
        120,
      )} | ${truncateText(errorMessage, 160)}\n`,
    );
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

      if (provider === 'heuristic_fallback') {
        const fallbackError =
          classified?.classification_raw_response?.error ??
          classified?.classification_raw_response?.message ??
          'unknown fallback reason';
        logFallback(index, paper, fallbackError);
        render(true);
      }
    },

    onError(index, paper, error) {
      inFlight = Math.max(0, inFlight - 1);
      stream.write(
        `\n[embedded-ai] Classification error #${index + 1}: ${truncateText(
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
        `[embedded-ai] Classification summary: total=${totalClassified}` +
          ` | tencent_tokenhub=${summary.tencent_tokenhub ?? 0}` +
          ` | heuristic=${summary.heuristic ?? 0}` +
          ` | heuristic_fallback=${summary.heuristic_fallback ?? 0}\n`,
      );
    },
  };
}