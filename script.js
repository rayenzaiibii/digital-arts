const uploadPanel = document.querySelector("#uploadPanel");
const optionsRow = document.querySelector("#optionsRow");
const dropZone = document.querySelector("#dropZone");
const imageInput = document.querySelector("#imageInput");
const loadingState = document.querySelector("#loadingState");
const loadingMessage = document.querySelector("#loadingMessage");
const resultView = document.querySelector("#resultView");
const originalImage = document.querySelector("#originalImage");
const generatedImage = document.querySelector("#generatedImage");
const storyText = document.querySelector("#storyText");
const storyCard = document.querySelector("#storyCard");
const aboutText = document.querySelector("#aboutText");
const aboutCard = document.querySelector("#aboutCard");
const legendList = document.querySelector("#legendList");
const errorMessage = document.querySelector("#errorMessage");
const changeImageButton = document.querySelector("#changeImageButton");
const downloadButton = document.querySelector("#downloadButton");
const printButton = document.querySelector("#printButton");
const colorCount = document.querySelector("#colorCount");
const colorCountValue = document.querySelector("#colorCountValue");
const wantStoryToggle = document.querySelector("#wantStory");
const sketchCanvas = document.querySelector("#sketchCanvas");
const sketchContext = sketchCanvas.getContext("2d", { willReadFrequently: true });

// Interactive Coloring UI
const interactiveCanvas = document.querySelector("#interactiveCanvas");
const intCtx = interactiveCanvas.getContext("2d", { willReadFrequently: true });
const toolBrush = document.querySelector("#toolBrush");
const toolFill = document.querySelector("#toolFill");
const toolEraser = document.querySelector("#toolEraser");
const toolClear = document.querySelector("#toolClear");
const brushSize = document.querySelector("#brushSize");
const brushSizeValue = document.querySelector("#brushSizeValue");

let currentTool = "brush";
let activeColor = "#ff7a59";
let isDrawing = false;
let lastX = 0;
let lastY = 0;

const SKETCH_SIZE = 768;
const PAPER_COLOR = "#fbf6e9";
const INK_COLOR = "#1c1a16";

const LOADING_MESSAGES = [
  "Mixing the colors…",
  "Drawing the outlines…",
  "Numbering the regions…",
  "Sharpening the pencils…",
  "Almost ready…",
];

let originalPreviewUrl = "";
let selectedFile = null;
let loadingInterval = null;

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("is-dragging");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("is-dragging");
});

dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("is-dragging");
  const file = event.dataTransfer.files[0];
  if (file) handleFile(file);
});

imageInput.addEventListener("change", () => {
  const file = imageInput.files[0];
  if (file) handleFile(file);
});

changeImageButton.addEventListener("click", openImagePicker);
downloadButton.addEventListener("click", downloadPage);
printButton.addEventListener("click", printPage);

colorCount.addEventListener("input", () => {
  colorCountValue.textContent = colorCount.value;
});

function openImagePicker() {
  imageInput.value = "";
  imageInput.click();
}

async function handleFile(file) {
  clearError();

  if (!file.type.startsWith("image/")) {
    showError("Please upload an image file.");
    return;
  }

  if (originalPreviewUrl) URL.revokeObjectURL(originalPreviewUrl);

  selectedFile = file;
  originalPreviewUrl = URL.createObjectURL(file);
  originalImage.src = originalPreviewUrl;

  let sketchBlob = null;
  try {
    const sourceImage = await loadImage(originalPreviewUrl);
    drawAutoSketch(sourceImage);
    sketchBlob = await canvasToBlob(sketchCanvas);
  } catch {
    /* sketch is optional — continue without it */
  }

  await runGeneration(sketchBlob);
}

let textPollTimer = null;

async function runGeneration(sketchBlob) {
  if (!selectedFile) return;

  clearTimeout(textPollTimer);
  setState("loading");

  const formData = new FormData();
  formData.append("image", selectedFile);
  if (sketchBlob) formData.append("sketch", sketchBlob, "sketch.png");
  formData.append("n_colors", colorCount.value);
  formData.append("want_story", wantStoryToggle.checked ? "true" : "false");

  try {
    const response = await fetch("/api/transform", {
      method: "POST",
      body: formData,
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.detail || "The transformation failed.");
    }
    if (!payload.image_base64) {
      throw new Error("The server did not return a coloring page.");
    }

    generatedImage.src = `data:image/png;base64,${payload.image_base64}`;
    
    generatedImage.onload = () => {
      interactiveCanvas.width = generatedImage.naturalWidth;
      interactiveCanvas.height = generatedImage.naturalHeight;
      intCtx.lineCap = "round";
      intCtx.lineJoin = "round";
      window.outlineData = null; // Clear cached outline for flood fill
    };

    renderLegend(payload.legend || []);
    renderStory(payload.story || "");
    renderAbout(payload.about || "");
    
    if (payload.text_rate_limited) {
      pollForText(formData);
    }

    setState("result");
  } catch (error) {
    setState("upload");
    showError(error.message);
  }
}

async function pollForText(formData) {
  clearTimeout(textPollTimer);
  
  try {
    const res = await fetch("/api/text", {
      method: "POST",
      body: formData,
    });
    
    if (res.status === 429) {
      textPollTimer = setTimeout(() => pollForText(formData), 15000);
      return;
    }
    
    if (!res.ok) {
      throw new Error("Failed to fetch text");
    }
    
    const payload = await res.json();
    if (payload.story) renderStory(payload.story);
    if (payload.about) renderAbout(payload.about);
    
  } catch (err) {
    console.error("Polling error:", err);
  }
}

function renderLegend(legend) {
  legendList.innerHTML = "";
  legend.forEach((entry, idx) => {
    const li = document.createElement("li");
    li.className = "legend-item";
    
    if (idx === 0) {
      li.classList.add("active");
      activeColor = entry.hex;
    }

    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.backgroundColor = entry.hex;
    swatch.textContent = entry.number;

    const meta = document.createElement("span");
    meta.className = "legend-meta";
    meta.innerHTML = `<strong>${entry.number}</strong><span>${entry.hex}</span>`;

    li.append(swatch, meta);
    
    li.addEventListener("click", () => {
      document.querySelectorAll(".legend-item").forEach(item => item.classList.remove("active"));
      li.classList.add("active");
      activeColor = entry.hex;
      if (currentTool === "eraser") setTool("brush");
    });
    
    legendList.append(li);
  });
}

function renderStory(story) {
  if (!story) {
    storyCard.hidden = true;
    storyText.textContent = "";
    return;
  }
  storyText.textContent = story;
  storyCard.hidden = false;
}

function renderAbout(about) {
  if (!about) {
    aboutCard.hidden = true;
    aboutText.textContent = "";
    return;
  }
  aboutText.textContent = about;
  aboutCard.hidden = false;
}

function downloadPage() {
  if (!generatedImage.src) return;
  
  const mergeCanvas = document.createElement("canvas");
  mergeCanvas.width = generatedImage.naturalWidth;
  mergeCanvas.height = generatedImage.naturalHeight;
  const mctx = mergeCanvas.getContext("2d");
  
  mctx.fillStyle = "#ffffff";
  mctx.fillRect(0, 0, mergeCanvas.width, mergeCanvas.height);
  
  // Draw colors first
  mctx.drawImage(interactiveCanvas, 0, 0);
  
  // Draw outlines on top with multiply
  mctx.globalCompositeOperation = "multiply";
  mctx.drawImage(generatedImage, 0, 0);
  
  const link = document.createElement("a");
  link.href = mergeCanvas.toDataURL("image/png");
  link.download = "coloring-page.png";
  document.body.append(link);
  link.click();
  link.remove();
}

function printPage() {
  if (!generatedImage.src) return;
  document.body.classList.add("is-printing");
  const cleanup = () => {
    document.body.classList.remove("is-printing");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function drawAutoSketch(image) {
  sketchCanvas.width = SKETCH_SIZE;
  sketchCanvas.height = SKETCH_SIZE;

  const fit = getContainRect(image.width, image.height, SKETCH_SIZE, SKETCH_SIZE);
  sketchContext.fillStyle = PAPER_COLOR;
  sketchContext.fillRect(0, 0, SKETCH_SIZE, SKETCH_SIZE);
  sketchContext.drawImage(image, fit.x, fit.y, fit.width, fit.height);

  const imageData = sketchContext.getImageData(0, 0, SKETCH_SIZE, SKETCH_SIZE);
  const pixels = imageData.data;
  const gray = new Uint8ClampedArray(SKETCH_SIZE * SKETCH_SIZE);

  for (let index = 0; index < gray.length; index += 1) {
    const pixelIndex = index * 4;
    gray[index] =
      pixels[pixelIndex] * 0.299 +
      pixels[pixelIndex + 1] * 0.587 +
      pixels[pixelIndex + 2] * 0.114;
  }

  for (let y = 0; y < SKETCH_SIZE; y += 1) {
    for (let x = 0; x < SKETCH_SIZE; x += 1) {
      const pixelIndex = (y * SKETCH_SIZE + x) * 4;
      pixels[pixelIndex] = 251;
      pixels[pixelIndex + 1] = 246;
      pixels[pixelIndex + 2] = 233;
      pixels[pixelIndex + 3] = 255;
    }
  }

  for (let y = 1; y < SKETCH_SIZE - 1; y += 1) {
    for (let x = 1; x < SKETCH_SIZE - 1; x += 1) {
      const index = y * SKETCH_SIZE + x;
      const gx =
        -gray[index - SKETCH_SIZE - 1] -
        gray[index - 1] * 2 -
        gray[index + SKETCH_SIZE - 1] +
        gray[index - SKETCH_SIZE + 1] +
        gray[index + 1] * 2 +
        gray[index + SKETCH_SIZE + 1];
      const gy =
        -gray[index - SKETCH_SIZE - 1] -
        gray[index - SKETCH_SIZE] * 2 -
        gray[index - SKETCH_SIZE + 1] +
        gray[index + SKETCH_SIZE - 1] +
        gray[index + SKETCH_SIZE] * 2 +
        gray[index + SKETCH_SIZE + 1];
      const strength = Math.abs(gx) + Math.abs(gy);

      if (strength > 118) {
        const pixelIndex = index * 4;
        const ink = Math.max(18, 120 - strength * 0.15);
        pixels[pixelIndex] = ink;
        pixels[pixelIndex + 1] = ink;
        pixels[pixelIndex + 2] = ink;
      }
    }
  }

  sketchContext.putImageData(imageData, 0, 0);
}

function getContainRect(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height,
  };
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The sketch could not be prepared."));
    }, "image/png");
  });
}

function setState(state) {
  uploadPanel.hidden = state !== "upload";
  optionsRow.hidden = state !== "upload";
  loadingState.hidden = state !== "loading";
  resultView.hidden = state !== "result";

  if (loadingInterval) {
    clearInterval(loadingInterval);
    loadingInterval = null;
  }
  if (state === "loading") {
    let i = 0;
    loadingMessage.textContent = LOADING_MESSAGES[0];
    loadingInterval = setInterval(() => {
      i = (i + 1) % LOADING_MESSAGES.length;
      loadingMessage.textContent = LOADING_MESSAGES[i];
    }, 2200);
  }
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

function clearError() {
  errorMessage.textContent = "";
  errorMessage.hidden = true;
}

// --- Interactive Drawing Logic ---

toolBrush.addEventListener("click", () => setTool("brush"));
toolFill.addEventListener("click", () => setTool("fill"));
toolEraser.addEventListener("click", () => setTool("eraser"));
toolClear.addEventListener("click", () => {
  intCtx.clearRect(0, 0, interactiveCanvas.width, interactiveCanvas.height);
});

brushSize.addEventListener("input", () => {
  brushSizeValue.textContent = brushSize.value;
});

function setTool(tool) {
  currentTool = tool;
  toolBrush.classList.toggle("active", tool === "brush");
  toolFill.classList.toggle("active", tool === "fill");
  toolEraser.classList.toggle("active", tool === "eraser");
  
  if (tool === "eraser") {
    interactiveCanvas.style.cursor = "crosshair";
  } else if (tool === "fill") {
    interactiveCanvas.style.cursor = "crosshair";
  } else {
    interactiveCanvas.style.cursor = "crosshair";
  }
}

function getPos(e) {
  const rect = interactiveCanvas.getBoundingClientRect();
  const scaleX = interactiveCanvas.width / rect.width;
  const scaleY = interactiveCanvas.height / rect.height;
  let clientX = e.clientX;
  let clientY = e.clientY;
  if (e.touches && e.touches.length > 0) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  }
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY
  };
}

function startDrawing(e) {
  if (e.cancelable) e.preventDefault();
  isDrawing = true;
  const pos = getPos(e);
  lastX = pos.x;
  lastY = pos.y;
  
  if (currentTool === "fill") {
    isDrawing = false;
    floodFill(Math.floor(pos.x), Math.floor(pos.y), hexToRgb(activeColor));
  } else {
    draw(e);
  }
}

function draw(e) {
  if (!isDrawing) return;
  if (e.cancelable) e.preventDefault();
  const pos = getPos(e);
  
  intCtx.lineWidth = brushSize.value;
  
  if (currentTool === "eraser") {
    intCtx.globalCompositeOperation = "destination-out";
    intCtx.strokeStyle = "rgba(0,0,0,1)";
  } else {
    intCtx.globalCompositeOperation = "source-over";
    intCtx.strokeStyle = activeColor;
  }
  
  intCtx.beginPath();
  intCtx.moveTo(lastX, lastY);
  intCtx.lineTo(pos.x, pos.y);
  intCtx.stroke();
  
  lastX = pos.x;
  lastY = pos.y;
}

function stopDrawing() {
  isDrawing = false;
}

interactiveCanvas.addEventListener("mousedown", startDrawing);
interactiveCanvas.addEventListener("mousemove", draw);
interactiveCanvas.addEventListener("mouseup", stopDrawing);
interactiveCanvas.addEventListener("mouseleave", stopDrawing);

interactiveCanvas.addEventListener("touchstart", startDrawing, {passive: false});
interactiveCanvas.addEventListener("touchmove", draw, {passive: false});
interactiveCanvas.addEventListener("touchend", stopDrawing);
interactiveCanvas.addEventListener("touchcancel", stopDrawing);

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : {r:0,g:0,b:0};
}

function floodFill(startX, startY, fillColorRgb) {
  const canvasWidth = interactiveCanvas.width;
  const canvasHeight = interactiveCanvas.height;
  
  if (!window.outlineData) {
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = canvasWidth;
    tempCanvas.height = canvasHeight;
    const tempCtx = tempCanvas.getContext("2d", { willReadFrequently: true });
    tempCtx.drawImage(generatedImage, 0, 0);
    window.outlineData = tempCtx.getImageData(0, 0, canvasWidth, canvasHeight).data;
  }
  
  const outlineData = window.outlineData;
  const imageData = intCtx.getImageData(0, 0, canvasWidth, canvasHeight);
  const data = imageData.data;
  
  const startPos = (startY * canvasWidth + startX) * 4;
  
  // Abort if clicking on black outline
  if (outlineData[startPos] < 50 && outlineData[startPos+1] < 50 && outlineData[startPos+2] < 50) return;
  
  const targetR = data[startPos];
  const targetG = data[startPos + 1];
  const targetB = data[startPos + 2];
  const targetA = data[startPos + 3];
  
  const fillR = fillColorRgb.r;
  const fillG = fillColorRgb.g;
  const fillB = fillColorRgb.b;
  
  if (targetR === fillR && targetG === fillG && targetB === fillB && targetA === 255) return;
  
  const stack = [[startX, startY]];
  
  function matchStartColor(pixelPos) {
    if (outlineData[pixelPos] < 100 && outlineData[pixelPos+1] < 100 && outlineData[pixelPos+2] < 100) return false;
    const r = data[pixelPos];
    const g = data[pixelPos + 1];
    const b = data[pixelPos + 2];
    const a = data[pixelPos + 3];
    return r === targetR && g === targetG && b === targetB && a === targetA;
  }
  
  function colorPixel(pixelPos) {
    data[pixelPos] = fillR;
    data[pixelPos + 1] = fillG;
    data[pixelPos + 2] = fillB;
    data[pixelPos + 3] = 255;
  }
  
  while(stack.length) {
    const [x, y] = stack.pop();
    let currentX = x;
    let pixelPos = (y * canvasWidth + currentX) * 4;
    
    while(currentX >= 0 && matchStartColor(pixelPos)) {
      currentX--;
      pixelPos -= 4;
    }
    
    currentX++;
    pixelPos += 4;
    
    let reachAbove = false;
    let reachBelow = false;
    
    while(currentX < canvasWidth && matchStartColor(pixelPos)) {
      colorPixel(pixelPos);
      
      if(y > 0) {
        if(matchStartColor(pixelPos - canvasWidth * 4)) {
          if(!reachAbove) {
            stack.push([currentX, y - 1]);
            reachAbove = true;
          }
        } else if(reachAbove) {
          reachAbove = false;
        }
      }
      
      if(y < canvasHeight - 1) {
        if(matchStartColor(pixelPos + canvasWidth * 4)) {
          if(!reachBelow) {
            stack.push([currentX, y + 1]);
            reachBelow = true;
          }
        } else if(reachBelow) {
          reachBelow = false;
        }
      }
      
      currentX++;
      pixelPos += 4;
    }
  }
  
  intCtx.putImageData(imageData, 0, 0);
}
