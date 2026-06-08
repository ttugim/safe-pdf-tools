// pdf.js와 pdf-lib는 index.html에서 CDN으로 불러옵니다.
// 이 파일은 모든 PDF 작업을 브라우저 내부에서만 처리합니다.

const { PDFDocument } = PDFLib;

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const compressionOptions = {
  low: { scale: 1.5, quality: 0.85 },
  medium: { scale: 1.2, quality: 0.7 },
  high: { scale: 0.9, quality: 0.5 }
};

const objectUrls = {
  compress: null,
  split: null,
  merge: null
};

const $ = (id) => document.getElementById(id);

function setStatus(element, message, type = "") {
  element.textContent = message;
  element.className = `status ${type}`.trim();
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function resetDownload(type, resultBox, link) {
  resultBox.classList.add("is-hidden");
  link.removeAttribute("href");

  if (objectUrls[type]) {
    URL.revokeObjectURL(objectUrls[type]);
    objectUrls[type] = null;
  }
}

function showDownload(type, bytes, filename, resultBox, link) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  objectUrls[type] = URL.createObjectURL(blob);

  link.href = objectUrls[type];
  link.download = filename;
  resultBox.classList.remove("is-hidden");
}

function getSelectedCompressionOption() {
  const selected = document.querySelector('input[name="compressionLevel"]:checked');
  return compressionOptions[selected ? selected.value : "medium"];
}

function canvasToJpegBytes(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          reject(new Error("JPEG 변환에 실패했습니다."));
          return;
        }

        resolve(await blob.arrayBuffer());
      },
      "image/jpeg",
      quality
    );
  });
}

async function compressPdf() {
  const fileInput = $("compressFile");
  const status = $("compressStatus");
  const resultBox = $("compressResult");
  const downloadLink = $("compressDownload");

  resetDownload("compress", resultBox, downloadLink);

  if (!fileInput.files.length) {
    setStatus(status, "PDF 파일을 먼저 선택해주세요.", "error");
    return;
  }

  const file = fileInput.files[0];
  const option = getSelectedCompressionOption();

  try {
    setStatus(status, "처리 중입니다. PDF 페이지를 이미지로 변환하고 있습니다.");

    const sourceBytes = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: sourceBytes.slice(0) });
    const pdf = await loadingTask.promise;
    const outputPdf = await PDFDocument.create();

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      setStatus(status, `처리 중입니다. ${pageNumber}/${pdf.numPages} 페이지 변환 중...`);

      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: option.scale });

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);

      await page.render({ canvasContext: context, viewport }).promise;

      const jpgBytes = await canvasToJpegBytes(canvas, option.quality);
      const jpgImage = await outputPdf.embedJpg(jpgBytes);

      const newPage = outputPdf.addPage([viewport.width, viewport.height]);
      newPage.drawImage(jpgImage, {
        x: 0,
        y: 0,
        width: viewport.width,
        height: viewport.height
      });

      canvas.width = 0;
      canvas.height = 0;
    }

    const compressedBytes = await outputPdf.save();
    const beforeSize = file.size;
    const afterSize = compressedBytes.length;
    const reduction = ((beforeSize - afterSize) / beforeSize) * 100;

    $("compressBefore").textContent = formatBytes(beforeSize);
    $("compressAfter").textContent = formatBytes(afterSize);
    $("compressReduction").textContent = `${reduction.toFixed(1)}%`;

    showDownload("compress", compressedBytes, "compressed.pdf", resultBox, downloadLink);
    setStatus(status, "압축이 완료되었습니다.", "success");
  } catch (error) {
    console.error(error);
    setStatus(status, "PDF 압축 중 오류가 발생했습니다. 다른 PDF로 다시 시도해주세요.", "error");
  }
}

async function updateSplitPageCount() {
  const fileInput = $("splitFile");
  const totalPagesElement = $("splitTotalPages");
  const status = $("splitStatus");

  $("splitResult").classList.add("is-hidden");
  totalPagesElement.textContent = "-";

  if (!fileInput.files.length) return;

  try {
    const bytes = await fileInput.files[0].arrayBuffer();
    const pdf = await PDFDocument.load(bytes);
    totalPagesElement.textContent = String(pdf.getPageCount());
    setStatus(status, "페이지 수를 확인했습니다.", "success");
  } catch (error) {
    console.error(error);
    setStatus(status, "PDF 페이지 수를 확인할 수 없습니다.", "error");
  }
}

function parsePageRange(input, totalPages) {
  const normalized = input.replace(/\s/g, "");

  if (!normalized) {
    throw new Error("페이지 범위를 입력해주세요.");
  }

  const pages = [];
  const parts = normalized.split(",");

  for (const part of parts) {
    if (/^\d+$/.test(part)) {
      const page = Number(part);
      validatePageNumber(page, totalPages);
      pages.push(page - 1);
      continue;
    }

    if (/^\d+-\d+$/.test(part)) {
      const [start, end] = part.split("-").map(Number);

      if (start > end) {
        throw new Error("페이지 범위의 시작 번호가 끝 번호보다 클 수 없습니다.");
      }

      validatePageNumber(start, totalPages);
      validatePageNumber(end, totalPages);

      for (let page = start; page <= end; page += 1) {
        pages.push(page - 1);
      }

      continue;
    }

    throw new Error("페이지 범위 형식이 올바르지 않습니다. 예: 1-3,5,7-9");
  }

  return [...new Set(pages)];
}

function validatePageNumber(page, totalPages) {
  if (page < 1 || page > totalPages) {
    throw new Error(`페이지 번호는 1부터 ${totalPages} 사이여야 합니다.`);
  }
}

async function splitPdf() {
  const fileInput = $("splitFile");
  const rangeInput = $("splitRange");
  const status = $("splitStatus");
  const resultBox = $("splitResult");
  const downloadLink = $("splitDownload");

  resetDownload("split", resultBox, downloadLink);

  if (!fileInput.files.length) {
    setStatus(status, "PDF 파일을 먼저 선택해주세요.", "error");
    return;
  }

  try {
    setStatus(status, "처리 중입니다. 선택한 페이지를 추출하고 있습니다.");

    const sourceBytes = await fileInput.files[0].arrayBuffer();
    const sourcePdf = await PDFDocument.load(sourceBytes);
    const totalPages = sourcePdf.getPageCount();
    const selectedIndexes = parsePageRange(rangeInput.value, totalPages);

    if (!selectedIndexes.length) {
      setStatus(status, "추출할 페이지를 선택해주세요.", "error");
      return;
    }

    const outputPdf = await PDFDocument.create();
    const copiedPages = await outputPdf.copyPages(sourcePdf, selectedIndexes);

    copiedPages.forEach((page) => outputPdf.addPage(page));

    const splitBytes = await outputPdf.save();

    showDownload("split", splitBytes, "extracted-pages.pdf", resultBox, downloadLink);
    setStatus(status, "페이지 추출이 완료되었습니다.", "success");
  } catch (error) {
    console.error(error);
    setStatus(status, error.message || "PDF 분할 중 오류가 발생했습니다.", "error");
  }
}

function updateMergeList() {
  const fileInput = $("mergeFiles");
  const list = $("mergeList");
  const status = $("mergeStatus");

  $("mergeResult").classList.add("is-hidden");
  list.innerHTML = "";

  if (!fileInput.files.length) {
    setStatus(status, "", "");
    return;
  }

  Array.from(fileInput.files).forEach((file, index) => {
    const item = document.createElement("li");
    item.textContent = `${index + 1}. ${file.name} (${formatBytes(file.size)})`;
    list.appendChild(item);
  });

  setStatus(status, `${fileInput.files.length}개의 PDF가 선택되었습니다.`);
}

async function mergePdfs() {
  const fileInput = $("mergeFiles");
  const status = $("mergeStatus");
  const resultBox = $("mergeResult");
  const downloadLink = $("mergeDownload");

  resetDownload("merge", resultBox, downloadLink);

  if (!fileInput.files.length) {
    setStatus(status, "PDF 파일을 먼저 선택해주세요.", "error");
    return;
  }

  if (fileInput.files.length < 2) {
    setStatus(status, "병합하려면 PDF 파일을 2개 이상 선택해주세요.", "error");
    return;
  }

  try {
    setStatus(status, "처리 중입니다. PDF 파일을 병합하고 있습니다.");

    const outputPdf = await PDFDocument.create();
    const files = Array.from(fileInput.files);

    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      const file = files[fileIndex];
      setStatus(status, `처리 중입니다. ${fileIndex + 1}/${files.length} 파일 병합 중...`);

      const sourceBytes = await file.arrayBuffer();
      const sourcePdf = await PDFDocument.load(sourceBytes);
      const pageIndexes = sourcePdf.getPageIndices();
      const copiedPages = await outputPdf.copyPages(sourcePdf, pageIndexes);

      copiedPages.forEach((page) => outputPdf.addPage(page));
    }

    const mergedBytes = await outputPdf.save();

    showDownload("merge", mergedBytes, "merged.pdf", resultBox, downloadLink);
    setStatus(status, "PDF 병합이 완료되었습니다.", "success");
  } catch (error) {
    console.error(error);
    setStatus(status, "PDF 병합 중 오류가 발생했습니다. 파일이 손상되지 않았는지 확인해주세요.", "error");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  $("compressButton").addEventListener("click", compressPdf);
  $("splitFile").addEventListener("change", updateSplitPageCount);
  $("splitButton").addEventListener("click", splitPdf);
  $("mergeFiles").addEventListener("change", updateMergeList);
  $("mergeButton").addEventListener("click", mergePdfs);
});
