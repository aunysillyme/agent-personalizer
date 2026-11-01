export function setupTrailer(video, environment = window, documentRef = document) {
  if (!video) return;
  const preference = environment.matchMedia('(prefers-reduced-motion: reduce)');
  const button = documentRef.querySelector('.trailer-toggle');
  const render = () => {
    const playing = !video.paused;
    button.setAttribute('aria-pressed', String(playing));
    button.setAttribute('aria-label', playing ? 'Pause trailer' : 'Play trailer');
    const label = button.querySelector?.('[data-button-label]') || button;
    label.textContent = playing ? 'Pause trailer' : 'Play trailer';
  };
  const play = () => { video.muted = true; return video.play().catch(render); };
  const applyPreference = () => {
    video.autoplay = !preference.matches;
    if (preference.matches) {
      video.removeAttribute('autoplay');
      video.pause();
      video.currentTime = 0;
      video.load();
    } else play();
    render();
  };
  video.addEventListener('play', render);
  video.addEventListener('pause', render);
  button.addEventListener('click', () => { if (video.paused) play(); else video.pause(); });
  preference.addEventListener('change', applyPreference);
  applyPreference();
  return { render };
}
if (typeof document !== 'undefined') setupTrailer(document.querySelector('#trailer video'));
