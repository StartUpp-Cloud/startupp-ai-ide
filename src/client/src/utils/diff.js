/**
 * Simple diff utility for comparing text versions
 * Uses a line-by-line comparison approach
 */

/**
 * Compute the diff between two texts
 * Returns an array of diff operations
 * @param {string} oldText - The original text
 * @param {string} newText - The new text
 * @returns {Array<{type: 'equal' | 'add' | 'remove', value: string}>}
 */
export function computeDiff(oldText, newText) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // Use Longest Common Subsequence (LCS) for better diff quality
  const lcs = computeLCS(oldLines, newLines);

  const diff = [];
  let oldIdx = 0;
  let newIdx = 0;
  let lcsIdx = 0;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    if (lcsIdx < lcs.length && oldIdx < oldLines.length && oldLines[oldIdx] === lcs[lcsIdx]) {
      // This line is in LCS - check if we need to add removed/added lines first
      while (newIdx < newLines.length && newLines[newIdx] !== lcs[lcsIdx]) {
        diff.push({ type: 'add', value: newLines[newIdx] });
        newIdx++;
      }
      // Add the equal line
      diff.push({ type: 'equal', value: oldLines[oldIdx] });
      oldIdx++;
      newIdx++;
      lcsIdx++;
    } else if (oldIdx < oldLines.length && (lcsIdx >= lcs.length || oldLines[oldIdx] !== lcs[lcsIdx])) {
      // Line was removed
      diff.push({ type: 'remove', value: oldLines[oldIdx] });
      oldIdx++;
    } else if (newIdx < newLines.length) {
      // Line was added
      diff.push({ type: 'add', value: newLines[newIdx] });
      newIdx++;
    }
  }

  return diff;
}

/**
 * Compute Longest Common Subsequence of two arrays
 */
function computeLCS(arr1, arr2) {
  const m = arr1.length;
  const n = arr2.length;

  // Create DP table
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  // Fill DP table
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (arr1[i - 1] === arr2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find LCS
  const lcs = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (arr1[i - 1] === arr2[j - 1]) {
      lcs.unshift(arr1[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return lcs;
}

/**
 * Get summary statistics for a diff
 * @param {Array} diff - The diff array from computeDiff
 * @returns {{additions: number, deletions: number, unchanged: number}}
 */
export function getDiffStats(diff) {
  return diff.reduce(
    (stats, item) => {
      if (item.type === 'add') stats.additions++;
      else if (item.type === 'remove') stats.deletions++;
      else stats.unchanged++;
      return stats;
    },
    { additions: 0, deletions: 0, unchanged: 0 }
  );
}

/**
 * Check if two texts are different
 */
export function hasChanges(oldText, newText) {
  return oldText !== newText;
}

/**
 * Format a date for display
 */
export function formatVersionDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
