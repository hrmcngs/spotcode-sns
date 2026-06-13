// Skeleton loading state for the timeline.
//
// Rendered before any real posts come back so the page doesn't sit
// on a black void while the network round trip runs. Each card mirrors
// the rough silhouette of a real .post (avatar circle, two text lines,
// action row) and animates via a shared shimmer keyframe in style.css.

export function renderTimelineSkeleton(rows = 4) {
  return (
    '<div class="skeleton-list" aria-hidden="true">' +
      Array.from({ length: rows }, () => skeletonCard()).join('') +
    '</div>'
  );
}

function skeletonCard() {
  return (
    '<div class="sk-post">' +
      '<div class="sk-avatar"></div>' +
      '<div class="sk-main">' +
        '<div class="sk-head">' +
          '<div class="sk-name"></div>' +
          '<div class="sk-handle"></div>' +
        '</div>' +
        '<div class="sk-body">' +
          '<div class="sk-line"></div>' +
          '<div class="sk-line sk-line--short"></div>' +
        '</div>' +
        '<div class="sk-actions">' +
          '<div class="sk-act"></div>' +
          '<div class="sk-act"></div>' +
          '<div class="sk-act"></div>' +
          '<div class="sk-act"></div>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}
