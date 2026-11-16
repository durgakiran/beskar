(() => {
  if (!("IntersectionObserver" in window)) return;

  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const demos = Array.from(document.querySelectorAll("[data-demo]"), (figure) => ({
    video: figure.querySelector("video"),
    button: figure.querySelector("button"),
    icon: figure.querySelector("[data-playback-icon]"),
    visibility: 0,
    pausedByUser: false,
  }));
  let manual = null;

  function updateControls(demo) {
    const action = demo.video.paused ? "Play" : "Pause";
    demo.button.setAttribute("aria-label", action + " " + demo.video.getAttribute("aria-label").toLowerCase());
    demo.icon.textContent = demo.video.paused ? "▶" : "Ⅱ";
  }

  function play(demo) {
    demo.video.play().catch(() => updateControls(demo));
  }

  function updatePlayback() {
    if (manual && manual.visibility < 0.15) {
      manual = null;
    }

    const autoplay = motion.matches ? null : demos
      .filter((demo) => !demo.pausedByUser && demo.visibility >= 0.55)
      .reduce((best, demo) => !best || demo.visibility > best.visibility ? demo : best, null);
    const active = document.hidden ? null : (manual || autoplay);

    for (const demo of demos) {
      if (demo === active) {
        if (demo.video.paused) play(demo);
      } else if (!demo.video.paused) {
        demo.video.pause();
      }
    }
  }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      demos.find((demo) => demo.video === entry.target).visibility = entry.intersectionRatio;
    }
    updatePlayback();
  }, { threshold: [0, 0.15, 0.55, 0.75, 1] });

  for (const demo of demos) {
    demo.video.controls = false;
    demo.button.hidden = false;
    demo.video.addEventListener("play", () => updateControls(demo));
    demo.video.addEventListener("pause", () => updateControls(demo));
    demo.button.addEventListener("click", () => {
      demo.pausedByUser = !demo.video.paused;
      manual = demo.pausedByUser ? null : demo;
      updatePlayback();
    });
    observer.observe(demo.video);
  }

  motion.addEventListener("change", () => {
    manual = null;
    updatePlayback();
  });
  document.addEventListener("visibilitychange", updatePlayback);
})();
