import * as pdfjsLib from
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";


/* =========================================================
   PDF.JS WORKER
   ========================================================= */

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";


/* =========================================================
   CONFIGURATION
   ========================================================= */

const CONFIG_URL = "config/journeys.json";

const MIN_SCALE = 0.7;
const MAX_SCALE = 2.5;
const ZOOM_STEP = 0.15;


/* =========================================================
   DOM ELEMENTS
   ========================================================= */

const params =
  new URLSearchParams(window.location.search);

const journeyId =
  params.get("journey");

const container =
  document.getElementById("viewer-container");

const pageLayer =
  document.getElementById("page-layer");

const loading =
  document.getElementById("loading");

const errorBox =
  document.getElementById("error");

const titleEl =
  document.getElementById("journey-title");

const pageStatus =
  document.getElementById("page-status");

const prevButton =
  document.getElementById("prev");

const nextButton =
  document.getElementById("next");

const zoomOutButton =
  document.getElementById("zoom-out");

const zoomInButton =
  document.getElementById("zoom-in");


/* =========================================================
   STATE
   ========================================================= */

let pdfDoc = null;

let currentPage = 1;

let scale = null;

let baseScale = null;

let resizeTimer = null;

let renderToken = 0;


/* =========================================================
   ERROR HANDLING
   ========================================================= */

function showError(message) {

  loading.hidden = true;

  errorBox.hidden = false;

  errorBox.textContent = message;
}


/* =========================================================
   UI CONTROLS
   ========================================================= */

function updateControls() {

  const total =
    pdfDoc?.numPages ?? 0;

  pageStatus.textContent =
    total
      ? `${currentPage} / ${total}`
      : "— / —";


  prevButton.disabled =
    !pdfDoc ||
    currentPage <= 1;


  nextButton.disabled =
    !pdfDoc ||
    currentPage >= total;
}


/* =========================================================
   CALCULATE WIDTH-FIT SCALE
   ========================================================= */

function getBaseScale(page) {

  const viewportAtOne =
    page.getViewport({
      scale: 1
    });

  const horizontalPadding =
    window.innerWidth <= 700
      ? 0
      : 40;

  const availableWidth =
    Math.max(
      280,
      container.clientWidth -
        horizontalPadding
    );

  const widthScale =
    availableWidth /
    viewportAtOne.width;

  return Math.min(
    1.6,
    widthScale
  );
}


/* =========================================================
   RENDER PAGE
   ========================================================= */

async function renderPage(
  pageNumber,
  preserveScroll = false
) {

  if (!pdfDoc) {
    return;
  }


  const token =
    ++renderToken;


  const page =
    await pdfDoc.getPage(pageNumber);


  if (token !== renderToken) {
    return;
  }


  if (baseScale === null) {

    baseScale =
      getBaseScale(page);
  }


  if (scale === null) {

    scale =
      baseScale;
  }


  const viewport =
    page.getViewport({
      scale
    });


  pageLayer.innerHTML = "";


  /* -------------------------------------------------------
     PAGE ELEMENT
     ------------------------------------------------------- */

  const pageElement =
    document.createElement("div");

  pageElement.className =
    "page";

  pageElement.style.width =
    `${viewport.width}px`;

  pageElement.style.height =
    `${viewport.height}px`;


  /* -------------------------------------------------------
     CANVAS
     ------------------------------------------------------- */

  const canvas =
    document.createElement("canvas");


  const context =
    canvas.getContext(
      "2d",
      {
        alpha: false
      }
    );


  const outputScale =
    Math.min(
      window.devicePixelRatio || 1,
      2
    );


  canvas.width =
    Math.ceil(
      viewport.width *
      outputScale
    );

  canvas.height =
    Math.ceil(
      viewport.height *
      outputScale
    );


  canvas.style.width =
    `${viewport.width}px`;

  canvas.style.height =
    `${viewport.height}px`;


  pageElement.appendChild(canvas);


  /* -------------------------------------------------------
     ANNOTATION LAYER
     ------------------------------------------------------- */

  const annotationLayer =
    document.createElement("div");

  annotationLayer.className =
    "annotation-layer";

  annotationLayer.style.width =
    `${viewport.width}px`;

  annotationLayer.style.height =
    `${viewport.height}px`;


  pageElement.appendChild(
    annotationLayer
  );


  pageLayer.appendChild(
    pageElement
  );


  /* -------------------------------------------------------
     RENDER PDF
     ------------------------------------------------------- */

  await page.render({

    canvasContext:
      context,

    viewport,

    transform:
      outputScale !== 1
        ? [
            outputScale,
            0,
            0,
            outputScale,
            0,
            0
          ]
        : null

  }).promise;


  if (token !== renderToken) {
    return;
  }


  /* -------------------------------------------------------
     PDF LINKS
     ------------------------------------------------------- */

  const annotations =
    await page.getAnnotations({
      intent: "display"
    });


  for (const annotation of annotations) {

    if (
      annotation.subtype !== "Link" ||
      !annotation.rect
    ) {
      continue;
    }


    const [
      x1,
      y1,
      x2,
      y2
    ] = annotation.rect;


    const [
      left,
      top
    ] =
      viewport.convertToViewportPoint(
        x1,
        y2
      );


    const [
      right,
      bottom
    ] =
      viewport.convertToViewportPoint(
        x2,
        y1
      );


    const link =
      document.createElement("a");


    link.style.left =
      `${Math.min(left, right)}px`;

    link.style.top =
      `${Math.min(top, bottom)}px`;

    link.style.width =
      `${Math.abs(right - left)}px`;

    link.style.height =
      `${Math.abs(bottom - top)}px`;


    link.setAttribute(
      "aria-label",
      "PDF link"
    );


    /*
     * -----------------------------------------------------
     * EXTERNAL LINK
     * -----------------------------------------------------
     */

    const externalUrl =
  annotation.url ||
  annotation.unsafeUrl;


if (externalUrl) {

  link.href =
    externalUrl;


  /*
   * Phone links must be allowed to navigate
   * normally on iOS so the operating system
   * can hand them off to the Phone app.
   */

  if (
    externalUrl.toLowerCase().startsWith("tel:")
  ) {

    link.target =
      "_self";

  } else {

    link.target =
      "_blank";

    link.rel =
      "noopener noreferrer";
  }
}


    /*
     * -----------------------------------------------------
     * INTERNAL PDF LINK
     * -----------------------------------------------------
     */

    else if (annotation.dest) {

      link.href =
        "#";


      link.addEventListener(
        "click",
        async (event) => {

          event.preventDefault();

          event.stopPropagation();


          const destinationPage =
            await resolveDestinationPage(
              annotation.dest
            );


          if (destinationPage) {

            await goToPage(
              destinationPage
            );
          }
        }
      );
    }


    /*
     * -----------------------------------------------------
     * ADD LINK TO ANNOTATION LAYER
     * -----------------------------------------------------
     */

    annotationLayer.appendChild(
      link
    );
  }


  /*
   * -------------------------------------------------------
   * PDF IS NOW READY
   * -------------------------------------------------------
   */

  loading.hidden = true;

  errorBox.hidden = true;

  updateControls();


  if (!preserveScroll) {

    container.scrollTop = 0;

    container.scrollLeft = 0;
  }
}


/* =========================================================
   RESOLVE INTERNAL PDF DESTINATION
   ========================================================= */

async function resolveDestinationPage(
  destination
) {

  try {

    const explicitDestination =
      typeof destination === "string"
        ? await pdfDoc.getDestination(
            destination
          )
        : destination;


    if (
      !explicitDestination ||
      !explicitDestination[0]
    ) {

      return null;
    }


    const pageIndex =
      await pdfDoc.getPageIndex(
        explicitDestination[0]
      );


    return pageIndex + 1;

  } catch {

    return null;
  }
}


/* =========================================================
   GO TO PAGE
   ========================================================= */

async function goToPage(
  pageNumber
) {

  if (!pdfDoc) {
    return;
  }


  const clamped =
    Math.max(
      1,
      Math.min(
        pdfDoc.numPages,
        pageNumber
      )
    );


  currentPage =
    clamped;


  await renderPage(
    currentPage
  );
}


/* =========================================================
   ZOOM
   ========================================================= */

async function changeZoom(
  delta
) {

  if (!pdfDoc) {
    return;
  }


  scale =
    Math.max(
      MIN_SCALE,
      Math.min(
        MAX_SCALE,
        (scale ??
          baseScale ??
          1) + delta
      )
    );


  await renderPage(
    currentPage,
    true
  );
}


/* =========================================================
   FIT TO WIDTH
   ========================================================= */

async function fitToWidth() {

  if (!pdfDoc) {
    return;
  }


  const page =
    await pdfDoc.getPage(
      currentPage
    );


  baseScale =
    getBaseScale(page);


  scale =
    baseScale;


  await renderPage(
    currentPage,
    true
  );
}


/* =========================================================
   BUTTON EVENTS
   ========================================================= */

prevButton.addEventListener(
  "click",
  () =>
    goToPage(
      currentPage - 1
    )
);


nextButton.addEventListener(
  "click",
  () =>
    goToPage(
      currentPage + 1
    )
);


zoomOutButton.addEventListener(
  "click",
  () =>
    changeZoom(
      -ZOOM_STEP
    )
);


zoomInButton.addEventListener(
  "click",
  () =>
    changeZoom(
      ZOOM_STEP
    )
);


/* =========================================================
   KEYBOARD NAVIGATION
   ========================================================= */

document.addEventListener(
  "keydown",
  (event) => {

    if (
      event.key === "ArrowLeft"
    ) {

      goToPage(
        currentPage - 1
      );
    }


    if (
      event.key === "ArrowRight"
    ) {

      goToPage(
        currentPage + 1
      );
    }


    if (
      event.key === "+" ||
      event.key === "="
    ) {

      changeZoom(
        ZOOM_STEP
      );
    }


    if (
      event.key === "-" ||
      event.key === "_"
    ) {

      changeZoom(
        -ZOOM_STEP
      );
    }


    if (event.key === "0") {

      fitToWidth();
    }
  }
);


/* =========================================================
   MOBILE SWIPE NAVIGATION
   ========================================================= */

let touchStartX = 0;

let touchStartY = 0;

let touchStartTime = 0;


container.addEventListener(
  "touchstart",
  (event) => {

    if (
      event.touches.length !== 1
    ) {
      return;
    }


    /*
     * Do not begin swipe tracking when
     * touching a PDF link.
     */

    if (
      event.target.closest(
        ".annotation-layer a"
      )
    ) {
      return;
    }


    touchStartX =
      event.touches[0].clientX;

    touchStartY =
      event.touches[0].clientY;

    touchStartTime =
      Date.now();

  },
  {
    passive: true
  }
);


container.addEventListener(
  "touchend",
  (event) => {

    if (
      event.changedTouches.length !== 1
    ) {
      return;
    }


    /*
     * Do not navigate pages when
     * releasing a PDF link.
     */

    if (
      event.target.closest(
        ".annotation-layer a"
      )
    ) {
      return;
    }


    const dx =
      event.changedTouches[0].clientX -
      touchStartX;


    const dy =
      event.changedTouches[0].clientY -
      touchStartY;


    const duration =
      Date.now() -
      touchStartTime;


    if (
      duration < 500 &&
      Math.abs(dx) > 70 &&
      Math.abs(dx) >
        Math.abs(dy) * 1.35
    ) {

      if (dx < 0) {

        goToPage(
          currentPage + 1
        );

      } else {

        goToPage(
          currentPage - 1
        );
      }
    }

  },
  {
    passive: true
  }
);


/* =========================================================
   DOUBLE-TAP ZOOM
   ========================================================= */

let lastTap = 0;


container.addEventListener(
  "touchend",
  (event) => {

    if (
      event.changedTouches.length !== 1
    ) {
      return;
    }


    /*
     * Do not trigger double-tap zoom
     * when interacting with a PDF link.
     */

    const tappedLink =
      event.target.closest(
        ".annotation-layer a"
      );

    if (tappedLink) {

      lastTap = 0;

      return;
    }


    const now =
      Date.now();


    if (
      now - lastTap < 300
    ) {

      if (
        scale <=
        (baseScale ?? 1) + 0.05
      ) {

        scale =
          Math.min(
            MAX_SCALE,
            (baseScale ?? 1) *
              1.65
          );

      } else {

        scale =
          baseScale;
      }


      renderPage(
        currentPage,
        true
      );
    }


    lastTap =
      now;

  },
  {
    passive: true
  }
);


/* =========================================================
   RESIZE
   ========================================================= */

window.addEventListener(
  "resize",
  () => {

    clearTimeout(
      resizeTimer
    );


    resizeTimer =
      setTimeout(
        () =>
          fitToWidth(),
        180
      );
  }
);


/* =========================================================
   BASIC DOWNLOAD / PRINT DETERRENTS
   ========================================================= */

document.addEventListener(
  "contextmenu",
  (event) => {

    event.preventDefault();
  }
);


document.addEventListener(
  "keydown",
  (event) => {

    if (
      (event.ctrlKey ||
        event.metaKey) &&
      (
        event.key === "s" ||
        event.key === "p"
      )
    ) {

      event.preventDefault();
    }
  }
);


/* =========================================================
   INITIALIZE VIEWER
   ========================================================= */

async function init() {

  /*
   * -------------------------------------------------------
   * CHECK JOURNEY PARAMETER
   * -------------------------------------------------------
   */

  if (!journeyId) {

    showError(
      "No journey was specified. Add ?journey=provence to the viewer URL."
    );

    return;
  }


  try {

    /*
     * -----------------------------------------------------
     * LOAD JOURNEY CONFIGURATION
     * -----------------------------------------------------
     */

    const response =
      await fetch(
        CONFIG_URL,
        {
          cache: "no-store"
        }
      );


    if (!response.ok) {

      throw new Error(
        "Unable to load journey configuration."
      );
    }


    const journeys =
      await response.json();


    const journey =
      journeys[journeyId];


    if (!journey) {

      throw new Error(
        `Journey "${journeyId}" was not found.`
      );
    }


    /*
     * -----------------------------------------------------
     * SET TITLE
     * -----------------------------------------------------
     */

    titleEl.textContent =
      journey.title;


    document.title =
      `Tablemouvant — ${journey.title}`;


    /*
     * -----------------------------------------------------
     * LOAD PDF
     * -----------------------------------------------------
 */

    pdfDoc =
      await pdfjsLib.getDocument({

        url: journey.pdf,

        useWorkerFetch: true,

        isEvalSupported: true

      }).promise;


    /*
     * -----------------------------------------------------
     * INITIAL STATE
     * -----------------------------------------------------
     */

    baseScale = null;

    scale = null;

    currentPage = 1;


    updateControls();


    await renderPage(
      currentPage
    );

  } catch (error) {

    console.error(
      error
    );


    showError(
      error.message ||
      "Unable to load this journey guide."
    );
  }
}


/* =========================================================
   START
   ========================================================= */

init();
