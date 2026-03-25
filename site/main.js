const COPY_RESET_DELAY_MS = 2000;

const copyButton = document.querySelector(".copy-btn");
const installBlock = document.querySelector(".install");

if (copyButton && installBlock) {
  copyButton.addEventListener("click", async () => {
    const value = installBlock.getAttribute("data-copy-value");
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      copyButton.classList.add("copied");
      window.setTimeout(() => {
        copyButton.classList.remove("copied");
      }, COPY_RESET_DELAY_MS);
    } catch {
      // Ignore clipboard failures; button remains usable.
    }
  });
}

const DEMO_ENABLED = true;

const tabs = Array.from(document.querySelectorAll("[data-video-tab]"));
const videos = Array.from(document.querySelectorAll("[data-video-panel]"));

let activeIndex = 0;

function setTabState(index) {
  tabs.forEach((tab, tabIndex) => {
    const isActive = tabIndex === index;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-pressed", String(isActive));
  });
}

function setVideoState(index) {
  videos.forEach((video, videoIndex) => {
    const isActive = videoIndex === index;
    video.classList.toggle("is-active", isActive);
    video.setAttribute("aria-hidden", String(!isActive));
  });
}

async function switchTo(index) {
  if (index === activeIndex) return;

  const outgoing = videos[activeIndex];
  if (outgoing) {
    outgoing.pause();
    outgoing.currentTime = 0;
  }

  activeIndex = index;
  setTabState(index);
  setVideoState(index);

  const incoming = videos[index];
  if (!incoming) return;
  incoming.currentTime = 0;

  try {
    await incoming.play();
  } catch {
    // Some browsers block autoplay until interaction.
  }
}

if (DEMO_ENABLED) {
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => {
      void switchTo(index);
    });
  });

  videos.forEach((video, index) => {
    video.addEventListener("ended", () => {
      void switchTo((index + 1) % videos.length);
    });
  });

  setTabState(activeIndex);
  setVideoState(activeIndex);

  const first = videos[activeIndex];
  if (first) {
    first.play().catch(() => {});
  }
}
